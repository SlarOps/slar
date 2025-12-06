import os
import yaml
import logging

logger = logging.getLogger(__name__)

def load_config():
    """
    Load configuration from YAML file specified by SLAR_CONFIG_PATH.
    If file exists, load it and set environment variables for compatibility.
    """
    config_path = os.getenv("SLAR_CONFIG_PATH")
    if not config_path:
        # Check default location if not set
        default_path = "/app/config/config.yaml"
        if os.path.exists(default_path):
            config_path = default_path
        else:
            logger.info("ℹ️  SLAR_CONFIG_PATH not set and default not found, skipping config file load")
            return

    try:
        with open(config_path, 'r') as f:
            config = yaml.safe_load(f)
            
        if not config:
            logger.warning(f"⚠️  Config file {config_path} is empty")
            return

        logger.info(f"✅ Loaded config from {config_path}")
        
        # Map config keys to environment variables
        env_mapping = {
            "database_url": "DATABASE_URL",
            "slack_bot_token": "SLACK_BOT_TOKEN",
            "slack_app_token": "SLACK_APP_TOKEN",
            # internal/config/config.go maps backend_url to SLAR_BACKEND_URL
            # slack_worker.py uses API_BASE_URL
            "backend_url": "API_BASE_URL", 
        }
        
        for config_key, env_key in env_mapping.items():
            if config_key in config and config[config_key]:
                if env_key not in os.environ:
                    os.environ[env_key] = str(config[config_key])
                    # logger.debug(f"Set {env_key} from config")

    except Exception as e:
        logger.error(f"❌ Failed to load config file: {e}")
