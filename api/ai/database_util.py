import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager
from typing import Optional, Dict, Any
from config import config

logger = logging.getLogger(__name__)

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


def ensure_user_exists(user_id: str, email: Optional[str] = None, name: Optional[str] = None) -> bool:
    """
    Ensure user exists in the users table.

    If user doesn't exist, creates a minimal record.
    This is needed because Supabase Auth users may not have a corresponding
    record in the application's users table.

    Args:
        user_id: User's UUID from Supabase Auth
        email: User's email (optional, from JWT token)
        name: User's name (optional, from JWT token or user_metadata)

    Returns:
        True if user exists or was created, False on error
    """
    if not user_id:
        logger.warning("ensure_user_exists: No user_id provided")
        return False

    try:
        # Check if user already exists
        existing = execute_query(
            "SELECT id FROM users WHERE id = %s",
            (user_id,),
            fetch="one"
        )

        if existing:
            logger.debug(f"✅ User already exists: {user_id}")
            return True

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
        return True

    except Exception as e:
        logger.error(f"❌ Failed to ensure user exists: {e}")
        return False


def extract_user_info_from_token(auth_token: str) -> Optional[Dict[str, Any]]:
    """
    Extract user info from Supabase JWT token.

    Returns dict with user_id, email, and name (if available).
    This is a lightweight extraction without full signature verification
    (signature should be verified by the caller using extract_user_id_from_token).

    Args:
        auth_token: JWT token from Supabase Auth

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

        # Try to get name from user_metadata or app_metadata
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
            "name": name
        }

    except Exception as e:
        logger.error(f"❌ Failed to extract user info from token: {e}")
        return None
