"""
OIDC Authentication Module

This module handles JWT verification for any OIDC-compliant provider.
Supports: Keycloak, Auth0, Okta, Azure AD, Google, etc.

Features:
- RS256/RS384/RS512 JWT verification using JWKS
- OIDC Discovery support (.well-known/openid-configuration)
- JWKS caching with automatic refresh
- User ID extraction from tokens
- Compatible with existing code structure

Uses authlib for robust OIDC/JWT handling:
https://docs.authlib.org/en/latest/jose/jwt.html
"""

import logging
import time
from typing import Optional, Dict, Any

import httpx
from authlib.jose import jwt as authlib_jwt
from authlib.jose import JsonWebKey
from authlib.jose.errors import JoseError, ExpiredTokenError, InvalidClaimError

logger = logging.getLogger(__name__)

# Cache for JWKS keys (10 min TTL)
_jwks_cache: Dict[str, Any] = {}
_jwks_cache_time: Dict[str, float] = {}
_discovery_cache: Dict[str, Any] = {}
JWKS_CACHE_TTL = 600  # 10 minutes


def get_oidc_discovery(issuer: str) -> Optional[Dict[str, Any]]:
    """
    Fetch OIDC discovery document.

    Args:
        issuer: OIDC issuer URL

    Returns:
        Discovery document or None if fetch fails
    """
    global _discovery_cache

    # Normalize issuer
    issuer = _normalize_issuer(issuer)

    if issuer in _discovery_cache:
        return _discovery_cache[issuer]

    try:
        discovery_url = f"{issuer}/.well-known/openid-configuration"
        logger.debug(f"Fetching OIDC discovery from: {discovery_url}")

        response = httpx.get(discovery_url, timeout=10)
        response.raise_for_status()
        discovery = response.json()

        _discovery_cache[issuer] = discovery
        logger.info(f"✅ OIDC discovery loaded from: {issuer}")
        return discovery

    except httpx.HTTPError as e:
        logger.error(f"HTTP error fetching OIDC discovery: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error fetching OIDC discovery: {e}")
        return None


def _normalize_issuer(issuer: str) -> str:
    """Normalize issuer URL (add https://, remove trailing slash)."""
    if not issuer.startswith("http://") and not issuer.startswith("https://"):
        issuer = f"https://{issuer}"
    return issuer.rstrip("/")


def _get_jwks(issuer: str) -> Optional[JsonWebKey]:
    """
    Fetch and cache JWKS from OIDC provider.

    Uses authlib's JsonWebKey for proper key handling.
    """
    global _jwks_cache, _jwks_cache_time

    issuer = _normalize_issuer(issuer)
    current_time = time.time()

    # Check cache validity
    if issuer in _jwks_cache:
        cache_time = _jwks_cache_time.get(issuer, 0)
        if current_time - cache_time < JWKS_CACHE_TTL:
            return _jwks_cache[issuer]
        logger.debug(f"JWKS cache expired for {issuer}")

    try:
        # Get JWKS URI from discovery
        discovery = get_oidc_discovery(issuer)
        if discovery and "jwks_uri" in discovery:
            jwks_url = discovery["jwks_uri"]
        else:
            # Fallback to common JWKS path
            jwks_url = f"{issuer}/.well-known/jwks.json"

        logger.debug(f"Fetching JWKS from: {jwks_url}")

        response = httpx.get(jwks_url, timeout=10)

        # Try alternative paths if default fails
        if response.status_code != 200:
            for path in ["/oauth/v2/keys", "/oauth2/v1/keys", "/oauth2/keys", "/.well-known/jwks"]:
                alt_url = f"{issuer}{path}"
                response = httpx.get(alt_url, timeout=10)
                if response.status_code == 200:
                    jwks_url = alt_url
                    break

        response.raise_for_status()
        jwks_data = response.json()

        # Use authlib's JsonWebKey to parse JWKS
        jwks = JsonWebKey.import_key_set(jwks_data)

        # Cache the JWKS
        _jwks_cache[issuer] = jwks
        _jwks_cache_time[issuer] = current_time
        logger.info(f"✅ JWKS cached for {issuer} ({len(jwks_data.get('keys', []))} keys)")

        return jwks

    except httpx.HTTPError as e:
        logger.error(f"HTTP error fetching JWKS: {e}")
        return None
    except Exception as e:
        logger.error(f"Error fetching JWKS: {type(e).__name__}: {e}")
        return None


def verify_oidc_token(token: str, issuer: str, client_id: str = None) -> Optional[Dict[str, Any]]:
    """
    Verify OIDC JWT token using JWKS public key.

    Uses authlib for robust JWT verification with automatic key selection.

    Args:
        token: JWT token string (without Bearer prefix)
        issuer: OIDC issuer URL (e.g., https://auth.your-domain.com)
        client_id: Optional client ID for audience validation

    Returns:
        Decoded token payload or None if verification fails

    Example:
        payload = verify_oidc_token(token, "https://auth.example.com")
        if payload:
            user_id = payload.get("sub")
    """
    try:
        issuer = _normalize_issuer(issuer)

        # Get JWKS
        jwks = _get_jwks(issuer)
        if not jwks:
            logger.error("Failed to fetch JWKS")
            return None

        # Build claims to validate
        claims_options = {
            "iss": {"essential": True, "value": issuer},
            "exp": {"essential": True},
            "iat": {"essential": True},
        }

        # Add audience validation if client_id provided
        if client_id:
            claims_options["aud"] = {"essential": True, "value": client_id}

        # Decode and verify token using authlib
        # authlib automatically selects the correct key based on 'kid' header
        claims = authlib_jwt.decode(
            token,
            jwks,
            claims_options=claims_options,
        )

        # Validate claims (exp, iat, iss, aud)
        claims.validate()

        logger.debug(f"Token verified successfully for user: {claims.get('sub')}")
        return dict(claims)

    except ExpiredTokenError:
        logger.warning("Token has expired")
        return None
    except InvalidClaimError as e:
        logger.warning(f"Invalid token claim: {e}")
        return None
    except JoseError as e:
        logger.warning(f"JWT verification failed: {type(e).__name__}: {e}")
        return None
    except httpx.HTTPError as e:
        logger.error(f"HTTP error during token verification: {e}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error verifying token: {type(e).__name__}: {e}")
        return None


def extract_user_id_from_oidc_token(auth_token: str, issuer: str, client_id: str = None) -> Optional[str]:
    """
    Extract and verify user ID from OIDC JWT token.

    Args:
        auth_token: JWT token (with or without Bearer prefix)
        issuer: OIDC issuer URL
        client_id: Optional client ID for audience validation

    Returns:
        User ID (sub claim) or None if verification fails

    Example:
        user_id = extract_user_id_from_oidc_token(
            "Bearer eyJhbGc...",
            "https://auth.example.com"
        )
    """
    if not auth_token:
        logger.warning("No auth token provided")
        return None

    if not issuer:
        logger.warning("No OIDC issuer configured")
        return None

    # Remove Bearer prefix if present
    token = auth_token.replace("Bearer ", "").strip()

    # Verify token and extract payload
    payload = verify_oidc_token(token, issuer, client_id)

    if payload:
        user_id = payload.get("sub")
        if user_id:
            logger.debug(f"Extracted user_id: {user_id}")
            return user_id
        else:
            logger.warning("Token does not contain 'sub' claim")

    return None


def get_user_info_from_oidc_token(auth_token: str, issuer: str, client_id: str = None) -> Optional[Dict[str, Any]]:
    """
    Extract full user info from OIDC JWT token.

    Args:
        auth_token: JWT token (with or without Bearer prefix)
        issuer: OIDC issuer URL
        client_id: Optional client ID for audience validation

    Returns:
        User info dictionary or None if verification fails

    Example:
        user_info = get_user_info_from_oidc_token(token, issuer)
        # Returns: {
        #     "id": "user-uuid",
        #     "email": "user@example.com",
        #     "name": "John Doe",
        #     "email_verified": True
        # }
    """
    if not auth_token or not issuer:
        return None

    # Remove Bearer prefix if present
    token = auth_token.replace("Bearer ", "").strip()

    # Verify token and extract payload
    payload = verify_oidc_token(token, issuer, client_id)

    if not payload:
        return None

    # Build user info compatible with existing code
    user_info = {
        "id": payload.get("sub"),
        "email": payload.get("email"),
        "name": payload.get("name") or _build_name(payload),
        "email_verified": payload.get("email_verified", False),
        "preferred_username": payload.get("preferred_username"),
        "locale": payload.get("locale"),
        "picture": payload.get("picture"),
    }

    # Add roles and groups if present (Keycloak, Auth0, etc.)
    if "roles" in payload:
        user_info["roles"] = payload["roles"]
    if "groups" in payload:
        user_info["groups"] = payload["groups"]

    # Keycloak realm_access roles
    if "realm_access" in payload:
        user_info["realm_roles"] = payload["realm_access"].get("roles", [])

    # Keycloak resource_access roles
    if "resource_access" in payload:
        user_info["resource_access"] = payload["resource_access"]

    # Auth0 custom claims
    if "https://auth0.com/claims" in payload:
        user_info["metadata"] = payload["https://auth0.com/claims"]

    return user_info


def _build_name(payload: Dict[str, Any]) -> str:
    """Build full name from given_name and family_name."""
    given = payload.get("given_name", "")
    family = payload.get("family_name", "")

    if given or family:
        return f"{given} {family}".strip()

    return payload.get("preferred_username", "User")


def extract_user_id_from_token(auth_token: str, issuer: str = None) -> Optional[str]:
    """
    Extract user ID from OIDC token.

    If issuer is not provided, it will try to get from config.
    """
    if not issuer:
        try:
            from config import config
            issuer = config.oidc_issuer
        except (ImportError, AttributeError):
            logger.warning("Could not get OIDC issuer from config")
            return None

    return extract_user_id_from_oidc_token(auth_token, issuer)


def clear_cache():
    """Clear all caches (useful for testing or after key rotation)."""
    global _jwks_cache, _jwks_cache_time, _discovery_cache
    _jwks_cache = {}
    _jwks_cache_time = {}
    _discovery_cache = {}
    logger.info("🗑️ OIDC caches cleared")
