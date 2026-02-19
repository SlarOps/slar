"""
Policy Evaluator — Declarative tool access control for AI agent.

Evaluates agent_policies at tool invocation time using:
  1. DENY match  → deny immediately, no user prompt
  2. ALLOW match → allow immediately, no user prompt
  3. No match    → fall through to existing behavior (allowed_tools or user prompt)

Conflict resolution: DENY > ALLOW at the same priority level.
Higher priority number wins over lower priority.

Usage:
    evaluator = PolicyEvaluator(org_id, project_id, user_id, go_api_url)
    await evaluator.load_for_session()

    # At session start — filter allowed_tools bypass list
    filtered = [t for t in allowed_tools
                if not await evaluator.is_denied(t)]

    # Inside permission_callback
    result = await evaluator.evaluate(tool_name)
    if result.matched:
        if result.effect == "deny":
            return PermissionResultDeny(message=result.reason)
        elif result.effect == "allow":
            return PermissionResultAllow()
    # No match → fall through
"""

import asyncio
import fnmatch
import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# How often to check remote version for cache invalidation (seconds)
VERSION_CHECK_INTERVAL = 60.0

# HTTP timeout for internal API calls
HTTP_TIMEOUT = 5.0


@dataclass
class Policy:
    """Represents a single agent_policy row from the database."""
    id: str
    org_id: str
    project_id: Optional[str]
    effect: str           # "allow" | "deny"
    principal_type: str   # "role" | "user" | "*"
    principal_value: Optional[str]
    tool_pattern: str     # fnmatch glob (e.g. "mcp__bash__*") or exact
    priority: int
    is_active: bool

    def matches_principal(self, user_id: str, user_role: Optional[str]) -> bool:
        """Check if this policy applies to the given user/role."""
        if self.principal_type == "*":
            return True
        if self.principal_type == "user":
            return self.principal_value == user_id
        if self.principal_type == "role":
            return self.principal_value == user_role
        return False

    def matches_tool(self, tool_name: str) -> bool:
        """Check if this policy's tool_pattern matches the given tool name."""
        if self.tool_pattern == "*":
            return True
        return fnmatch.fnmatch(tool_name, self.tool_pattern)


@dataclass
class EvaluationResult:
    """Result of evaluating policies for a tool invocation."""
    matched: bool
    effect: Optional[str]          # "allow" | "deny" | None
    policy_id: Optional[str]
    policy_name: Optional[str]     # Not stored in Policy but useful for logging
    reason: str


class PolicyEvaluator:
    """
    One instance per WebSocket session.

    Loads policies from Go API once at connect time, then checks the remote
    version counter every VERSION_CHECK_INTERVAL seconds to detect changes.
    """

    def __init__(
        self,
        org_id: str,
        project_id: Optional[str],
        user_id: str,
        go_api_url: str,
    ):
        self._org_id = org_id
        self._project_id = project_id
        self._user_id = user_id
        self._go_api_url = go_api_url.rstrip("/")

        self._cache: list[Policy] = []
        self._version: int = 0
        self._loaded_at: float = 0.0
        self._user_role: Optional[str] = None  # cached once per session

        # Shared async HTTP client
        self._client: Optional[httpx.AsyncClient] = None

    # ------------------------------------------------------------------ #
    # Lifecycle
    # ------------------------------------------------------------------ #

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._go_api_url,
                timeout=HTTP_TIMEOUT,
            )
        return self._client

    async def close(self):
        """Release the HTTP client. Call on session teardown."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def load_for_session(self):
        """
        Called once at WebSocket connect. Fetches fresh policies and resolves
        the user's role so the first tool call has no extra latency.
        """
        try:
            self._cache, self._version = await self._fetch_policies()
            self._loaded_at = time.monotonic()
            await self._resolve_role()
            logger.info(
                f"🔐 PolicyEvaluator loaded {len(self._cache)} policies "
                f"(v{self._version}) for org={self._org_id} role={self._user_role}"
            )
        except Exception as e:
            logger.warning(f"PolicyEvaluator.load_for_session failed: {e} — proceeding without policies")
            self._cache = []

    # ------------------------------------------------------------------ #
    # Core Evaluation
    # ------------------------------------------------------------------ #

    async def evaluate(self, tool_name: str) -> EvaluationResult:
        """
        Evaluate all active policies for the given tool invocation.

        Algorithm:
          1. Filter policies matching this principal AND this tool
          2. Sort by priority DESC (already sorted from fetch)
          3. At each priority level, DENY beats ALLOW
          4. Return the first decision found
        """
        matching: list[Policy] = [
            p for p in self._cache
            if p.is_active
            and p.matches_principal(self._user_id, self._user_role)
            and p.matches_tool(tool_name)
        ]

        if not matching:
            return EvaluationResult(
                matched=False, effect=None,
                policy_id=None, policy_name=None,
                reason="no matching policy"
            )

        # Group by priority level and pick DENY > ALLOW within same level
        # matching is already sorted by priority DESC from SQL
        best: Optional[Policy] = None
        current_priority = matching[0].priority

        for policy in matching:
            if policy.priority < current_priority:
                # We've already processed the highest priority level
                break
            if policy.effect == "deny":
                best = policy
                break  # DENY wins at this priority level, no need to look further
            if best is None:
                best = policy  # tentative ALLOW

        if best is None:
            return EvaluationResult(
                matched=False, effect=None,
                policy_id=None, policy_name=None,
                reason="no matching policy"
            )

        reason = (
            f"policy '{best.id}' ({best.effect}) "
            f"principal={best.principal_type}:{best.principal_value} "
            f"pattern={best.tool_pattern} "
            f"priority={best.priority}"
        )
        return EvaluationResult(
            matched=True,
            effect=best.effect,
            policy_id=best.id,
            policy_name=None,  # name not stored in Policy (avoid extra storage)
            reason=reason,
        )

    async def is_denied(self, tool_name: str) -> bool:
        """Convenience helper: True if any DENY policy matches (used to filter allowed_tools)."""
        result = await self.evaluate(tool_name)
        return result.matched and result.effect == "deny"

    # ------------------------------------------------------------------ #
    # Cache Invalidation
    # ------------------------------------------------------------------ #

    async def refresh_if_stale(self):
        """
        Called at the start of each permission_callback invocation.
        Checks the remote version counter every VERSION_CHECK_INTERVAL seconds.
        If the version has changed, reloads the full policy cache.
        """
        if time.monotonic() - self._loaded_at < VERSION_CHECK_INTERVAL:
            return

        try:
            remote_version = await self._fetch_version()
            if remote_version != self._version:
                logger.info(
                    f"🔄 PolicyEvaluator: version changed {self._version} → {remote_version}, reloading"
                )
                await self.load_for_session()
            else:
                # Update timestamp to defer next check
                self._loaded_at = time.monotonic()
        except Exception as e:
            logger.warning(f"PolicyEvaluator.refresh_if_stale failed: {e}")
            self._loaded_at = time.monotonic()

    # ------------------------------------------------------------------ #
    # Private Helpers
    # ------------------------------------------------------------------ #

    async def _fetch_policies(self) -> tuple[list[Policy], int]:
        """Fetch active policies from Go API internal endpoint."""
        client = await self._get_client()
        params: dict = {"org_id": self._org_id, "active_only": "true"}
        if self._project_id:
            params["project_id"] = self._project_id

        resp = await client.get("/internal/policies", params=params)
        resp.raise_for_status()
        data = resp.json()

        raw_policies = data.get("policies") or []
        policies = [self._parse_policy(p) for p in raw_policies if p]

        # Fetch version in the same call batch
        version = await self._fetch_version()

        return policies, version

    async def _fetch_version(self) -> int:
        """Fetch the policy version counter for this org."""
        client = await self._get_client()
        resp = await client.get(
            "/internal/policies/version",
            params={"org_id": self._org_id},
        )
        if resp.status_code == 404:
            return 0
        resp.raise_for_status()
        data = resp.json()
        return int(data.get("version", 0))

    async def _resolve_role(self):
        """Resolve the user's effective role (project > org) and cache it."""
        from authz.client import AuthzClient

        authz = AuthzClient(self._go_api_url)
        try:
            role = None
            if self._project_id:
                role = await authz.get_project_role(self._user_id, self._project_id)
            if role is None:
                role = await authz.get_org_role(self._user_id, self._org_id)
            self._user_role = str(role.value) if role else None
        except Exception as e:
            logger.warning(f"PolicyEvaluator._resolve_role failed: {e}")
            self._user_role = None
        finally:
            await authz.close()

    @staticmethod
    def _parse_policy(raw: dict) -> Optional[Policy]:
        """Parse a raw dict from the API into a Policy dataclass."""
        try:
            return Policy(
                id=raw["id"],
                org_id=raw["org_id"],
                project_id=raw.get("project_id"),
                effect=raw["effect"],
                principal_type=raw["principal_type"],
                principal_value=raw.get("principal_value"),
                tool_pattern=raw.get("tool_pattern", "*"),
                priority=int(raw.get("priority", 0)),
                is_active=bool(raw.get("is_active", True)),
            )
        except (KeyError, ValueError, TypeError) as e:
            logger.warning(f"PolicyEvaluator: failed to parse policy {raw}: {e}")
            return None
