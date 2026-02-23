"""
FastAPI dependencies for authentication and authorization.

Provides reusable dependencies for:
- Token validation
- User context extraction
- Organization/Project context
"""

import logging
from typing import Optional
from fastapi import Header, HTTPException, status, Query, Request
from pydantic import BaseModel

from database_util import resolve_user_id_from_token, extract_user_info_from_token
from workspace_service import extract_user_id_from_token

logger = logging.getLogger(__name__)


class AuthContext(BaseModel):
    """Authenticated user context with optional organization/project scope."""
    user_id: str
    provider_id: str  # Original provider ID from JWT
    email: Optional[str] = None
    name: Optional[str] = None
    org_id: Optional[str] = None
    project_id: Optional[str] = None


class UserContext(BaseModel):
    """Basic user context (just user_id)."""
    user_id: str


async def get_current_user(
    authorization: Optional[str] = Header(None, description="Bearer token")
) -> UserContext:
    """
    Dependency to get current authenticated user.

    Validates Authorization header and extracts user_id.

    Args:
        authorization: JWT token from Authorization header (format: "Bearer <token>")

    Returns:
        UserContext with user_id

    Raises:
        HTTPException 401: Missing or invalid token
    """
    if not authorization:
        logger.warning("Missing Authorization header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Resolve actual database user_id from token
    user_id = resolve_user_id_from_token(authorization)

    if not user_id:
        logger.warning("Invalid token or failed to resolve user_id")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return UserContext(user_id=user_id)


async def get_auth_context(
    authorization: Optional[str] = Header(None, description="Bearer token"),
    org_id: Optional[str] = Query(None, description="Organization ID for ReBAC"),
    project_id: Optional[str] = Query(None, description="Project ID for scoping"),
    request: Request = None,
) -> AuthContext:
    """
    Dependency to get full authentication context with org/project scope.

    This is the RECOMMENDED dependency for most API endpoints.
    Extracts:
    - user_id (from token, via database resolution)
    - provider_id (original JWT subject)
    - email, name (from JWT claims)
    - org_id (from query param or X-Org-ID header)
    - project_id (from query param or X-Project-ID header)

    Args:
        authorization: JWT token from Authorization header
        org_id: Organization ID from query param
        project_id: Project ID from query param
        request: FastAPI request object (for header fallback)

    Returns:
        AuthContext with user info and org/project scope

    Raises:
        HTTPException 401: Missing or invalid token
    """
    # Validate token
    if not authorization:
        logger.warning("Missing Authorization header")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Extract provider_id from JWT
    provider_id = extract_user_id_from_token(authorization)
    if not provider_id:
        logger.warning("Failed to extract provider_id from token")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Resolve actual database user_id
    user_id = resolve_user_id_from_token(authorization)
    if not user_id:
        logger.warning(f"Failed to resolve user_id for provider_id: {provider_id}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Extract additional user info from JWT
    user_info = extract_user_info_from_token(authorization)
    email = user_info.get("email") if user_info else None
    name = user_info.get("name") if user_info else None

    # Extract org_id from query param or header (fallback)
    final_org_id = org_id
    if not final_org_id and request:
        final_org_id = request.headers.get("X-Org-ID")

    # Extract project_id from query param or header (fallback)
    final_project_id = project_id
    if not final_project_id and request:
        final_project_id = request.headers.get("X-Project-ID")

    return AuthContext(
        user_id=user_id,
        provider_id=provider_id,
        email=email,
        name=name,
        org_id=final_org_id,
        project_id=final_project_id,
    )


async def get_auth_context_required_org(
    context: AuthContext = None,
) -> AuthContext:
    """
    Dependency that requires org_id to be present.

    Use this for endpoints that MUST have organization context (ReBAC pattern).
    Chain this after get_auth_context.

    Example:
        @router.get("/api/resources")
        async def get_resources(
            ctx: AuthContext = Depends(get_auth_context_required_org)
        ):
            # ctx.org_id is guaranteed to exist here
            ...

    Args:
        context: AuthContext from get_auth_context

    Returns:
        Same AuthContext

    Raises:
        HTTPException 400: Missing org_id
    """
    if not context:
        # Should not happen if properly chained
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal error: context not initialized"
        )

    if not context.org_id:
        logger.warning(f"Missing org_id for user {context.user_id}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="organization_id is required. Provide org_id query param or X-Org-ID header for tenant isolation",
        )

    return context


# Convenience: Combined dependency for org-required endpoints
async def require_org_context(
    authorization: Optional[str] = Header(None),
    org_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    request: Request = None,
) -> AuthContext:
    """
    Convenience dependency that combines get_auth_context + require org_id.

    Use this for endpoints following ReBAC pattern (most endpoints).

    Example:
        @router.get("/api/resources")
        async def get_resources(ctx: AuthContext = Depends(require_org_context)):
            # ctx.user_id and ctx.org_id are guaranteed to exist
            # ctx.project_id is optional
            ...
    """
    context = await get_auth_context(
        authorization=authorization,
        org_id=org_id,
        project_id=project_id,
        request=request,
    )

    if not context.org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="organization_id is required. Provide org_id query param or X-Org-ID header for tenant isolation",
        )

    return context


async def require_project_context(
    authorization: Optional[str] = Header(None),
    org_id: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    request: Request = None,
) -> AuthContext:
    """
    Convenience dependency for project-scoped endpoints.

    Requires both org_id AND project_id to be present.
    Use this for resources that are strictly project-scoped (e.g., cost logs, credentials).

    Example:
        @router.get("/api/cost-logs")
        async def get_cost_logs(ctx: AuthContext = Depends(require_project_context)):
            # ctx.user_id, ctx.org_id, and ctx.project_id are all guaranteed to exist
            ...
    """
    context = await get_auth_context(
        authorization=authorization,
        org_id=org_id,
        project_id=project_id,
        request=request,
    )

    if not context.org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="org_id is required",
        )

    if not context.project_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="project_id is required (this resource is project-scoped)",
        )

    return context
