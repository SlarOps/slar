import os
import yaml
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

def load_config():
    """
    Load configuration from YAML file specified by SLAR_CONFIG_PATH.
    If file exists, load it and set environment variables for compatibility.

    Priority:
    1. SLAR_CONFIG_PATH env var
    2. /app/config/config.yaml (production)
    3. ./config.dev.yaml (local development)
    """
    config_path = os.getenv("SLAR_CONFIG_PATH")
    if not config_path:
        # Check default locations
        default_paths = [
            "/app/config/config.yaml",  # Production (Docker)
            os.path.join(os.path.dirname(__file__), ".config.dev.yaml"),  # Local dev
        ]
        for path in default_paths:
            if os.path.exists(path):
                config_path = path
                break

        if not config_path:
            logger.info("ℹ️  No config file found, skipping config file load")
            return

    try:
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
            
        if not config:
            logger.warning(f"⚠️  Config file {config_path} is empty")
            return

        logger.info(f"✅ Loaded config from {config_path}")
        
        # Map config keys to environment variables
        # This allows existing code using os.getenv to work without changes
        env_mapping = {
            "database_url": "DATABASE_URL",
            
            # API Connections
            "slar_api_url": "SLAR_API_URL",
            "backend_url": "SLAR_BACKEND_URL",
            
            # Supabase
            "supabase_url": "SUPABASE_URL",
            "supabase_service_role_key": "SUPABASE_SERVICE_ROLE_KEY",
            "supabase_jwt_secret": "SUPABASE_JWT_SECRET",
        }
        
        for config_key, env_key in env_mapping.items():
            if config_key in config and config[config_key]:
                if env_key not in os.environ:
                    os.environ[env_key] = str(config[config_key])
                    print(f"[config_loader] Set {env_key}={config[config_key][:30]}...")

    except Exception as e:
        logger.error(f"❌ Failed to load config file: {e}")
