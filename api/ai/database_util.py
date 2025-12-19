import os
import logging
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL")

@contextmanager
def get_db_connection():
    """
    Context manager for database connection.
    Yields a cursor that returns results as dictionaries.
    Automatically handles commit/rollback and connection closing.
    """
    conn = None
    try:
        if not DATABASE_URL:
            raise ValueError("DATABASE_URL environment variable is not set")
            
        conn = psycopg2.connect(DATABASE_URL)
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
