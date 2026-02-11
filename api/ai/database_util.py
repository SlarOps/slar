import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from typing import Optional, Dict, Any, Tuple
import functools
from config import config

logger = logging.getLogger(__name__)


def resolve_user_id_from_token(auth_token: str) -> Optional[str]:
    """
    Extract provider_id from token and resolve to actual DB user_id.

    This is the preferred way to get user_id for DB operations.
    Handles the case where Go API created user with different id than provider_id.

    Args:
        auth_token: JWT token (with or without 'Bearer ' prefix)

    Returns:
        Actual database user_id, or None on error
    """
    from workspace_service import extract_user_id_from_token

    provider_id = extract_user_id_from_token(auth_token)
    if not provider_id:
        return None

    user_info = extract_user_info_from_token(auth_token)
    return ensure_user_exists(
        provider_id,
        email=user_info.get("email") if user_info else None,
        name=user_info.get("name") if user_info else None
    )

@contextmanager
def get_db_connection():
    """
    Context manager for database connection.
    Yields a cursor that returns results as dictionaries.
    Automatically handles commit/rollback and connection closing.
    """
    conn = None
    try:
        if not config.database_url:
            raise ValueError("DATABASE_URL environment variable is not set")

        conn = psycopg2.connect(config.database_url)
        yield conn
    except Exception as e:
        logger.error(f"❌ Database connection error: {e}")
        if conn:
            conn.rollback()
        raise
    finally:
        if conn:
            conn.close()

def execute_query(query: str, params: tuple = None, fetch: str = "all"):
    """
    Execute a raw SQL query.
    
    Args:
        query: SQL query string
        params: Tuple of parameters for the query
        fetch: "all" for list of dicts, "one" for single dict, "none" for no return
        
    Returns:
        List[Dict], Dict, or None
    """
    with get_db_connection() as conn:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            try:
                cur.execute(query, params)
                
                if fetch == "all":
                    return cur.fetchall()
                elif fetch == "one":
                    return cur.fetchone()
                else:
                    conn.commit()
                    return None
            except Exception as e:
                logger.error(f"❌ Query execution failed: {e}")
                logger.debug(f"Query: {query}, Params: {params}")
                raise


@functools.lru_cache(maxsize=1000)
def _get_cached_user_id(user_id: str) -> Optional[str]:
    """
    Cached lookup for user ID.
    Only returns if user exists in DB.
    """
    try:
        existing = execute_query(
            "SELECT id FROM users WHERE id = %s OR provider_id = %s",
            (user_id, user_id),
            fetch="one"
        )
        if existing:
            return existing.get('id')
    except Exception as e:
        logger.error(f"❌ Cache lookup failed: {e}")
    return None

def ensure_user_exists(user_id: str, email: Optional[str] = None, name: Optional[str] = None) -> Optional[str]:
    """
    Ensure user exists in the users table and return the actual DB user ID.

    If user doesn't exist, creates a minimal record.
    This is needed because Supabase Auth users may not have a corresponding
    record in the application's users table.

    IMPORTANT: Go API may create users with different ID than provider_id.
    This function returns the ACTUAL database user ID for foreign key references.

    Args:
        user_id: User's UUID from OIDC provider (provider_id / sub claim)
        email: User's email (optional, from JWT token)
        name: User's name (optional, from JWT token or user_metadata)

    Returns:
        Actual database user ID (may differ from user_id param), or None on error
    """
    if not user_id:
        logger.warning("ensure_user_exists: No user_id provided")
        return None

    # Try cache first (fast path)
    cached_id = _get_cached_user_id(user_id)
    if cached_id:
        return cached_id

    try:
        # Check if user already exists (by id, provider_id, OR email)
        # This handles the case where Go API created user with different id
        existing = execute_query(
            "SELECT id FROM users WHERE id = %s OR provider_id = %s OR (email = %s AND %s != '')",
            (user_id, user_id, email or '', email or ''),
            fetch="one"
        )

        if existing:
            actual_id = existing.get('id')
            logger.debug(f"✅ User already exists: provider_id={user_id} -> db_id={actual_id}")
            # Update cache manually since we bypassed it with email check
            _get_cached_user_id.cache_clear() # Invalidate to be safe or rely on next hit
            return actual_id

        # User doesn't exist, create minimal record
        # Use email prefix as name if name not provided
        if not name and email:
            name = email.split("@")[0]
        elif not name:
            name = f"User_{user_id[:8]}"

        if not email:
            email = f"{user_id}@placeholder.local"

        logger.info(f"📝 Creating user record for: {user_id} ({email})")

        execute_query(
            """
            INSERT INTO users (id, name, email, role, team, is_active, created_at, updated_at, provider_id)
            VALUES (%s, %s, %s, %s, %s, %s, NOW(), NOW(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (user_id, name, email, "user", "default", True, user_id),
            fetch="none"
        )

        logger.info(f"✅ Created user record: {user_id}")
        
        # Clear cache so next lookup finds it
        _get_cached_user_id.cache_clear()
        
        return user_id

    except Exception as e:
        logger.error(f"❌ Failed to ensure user exists: {e}")
        return None


def extract_user_info_from_token(auth_token: str) -> Optional[Dict[str, Any]]:
    """
    Extract user info from JWT token (supports OIDC and Supabase formats).

    Returns dict with user_id, email, and name (if available).
    This is a lightweight extraction without full signature verification
    (signature should be verified by the caller using extract_user_id_from_token).

    Supports:
    - OIDC standard claims: sub, email, name, given_name, family_name, preferred_username
    - Supabase claims: user_metadata, app_metadata

    Args:
        auth_token: JWT token from OIDC provider or Supabase Auth

    Returns:
        Dict with user_id, email, name or None on error
    """
    import jwt

    if not auth_token:
        return None

    try:
        # Remove 'Bearer ' prefix if present
        token = auth_token.replace("Bearer ", "").strip()

        # Decode without verification (caller should verify first)
        decoded = jwt.decode(token, options={"verify_signature": False})

        user_id = decoded.get("sub")
        email = decoded.get("email")

        # Try to get name from various sources (OIDC and Supabase compatible)
        name = None

        # 1. Standard OIDC claims
        if decoded.get("name"):
            name = decoded.get("name")
        elif decoded.get("given_name") or decoded.get("family_name"):
            # Build name from given_name + family_name
            given = decoded.get("given_name", "")
            family = decoded.get("family_name", "")
            name = f"{given} {family}".strip()
        elif decoded.get("preferred_username"):
            name = decoded.get("preferred_username")

        # 2. Supabase specific claims (fallback)
        if not name:
            user_metadata = decoded.get("user_metadata", {})
            app_metadata = decoded.get("app_metadata", {})

            name = (
                user_metadata.get("full_name") or
                user_metadata.get("name") or
                app_metadata.get("full_name") or
                app_metadata.get("name") or
                None
            )

        return {
            "user_id": user_id,
            "email": email,
            "name": name,
            # Additional OIDC fields for reference
            "preferred_username": decoded.get("preferred_username"),
            "email_verified": decoded.get("email_verified", False),
        }

    except Exception as e:
        logger.error(f"❌ Failed to extract user info from token: {e}")
        return None
