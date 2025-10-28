"""
Centralized settings and configuration management.

This module provides a single source of truth for all configuration values
used throughout the SLAR AI system.
"""

import os
from functools import lru_cache
from typing import Optional


class Settings:
    """
    Application settings with environment variable support.

    All configuration values should be accessed through this class
    to ensure consistency and make testing easier.
    """

    def __init__(self):
        # API Configuration
        self.host: str = os.getenv("HOST", "0.0.0.0")
        self.port: int = int(os.getenv("PORT", "8002"))

        # OpenAI Configuration
        self.openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
        self.openai_model: str = os.getenv("OPENAI_MODEL", "gpt-5")

        # Anthropic Configuration (for Claude Agent SDK)
        self.anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
        self.anthropic_model: str = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-5-20250929")

        # Data Storage
        # Default to data/ subdirectory in the ai/ folder
        default_data_store = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
        self.data_store: str = os.getenv("DATA_STORE", default_data_store)

        # Vector Store Configuration
        self.chroma_collection_name: str = os.getenv("CHROMA_COLLECTION_NAME", "autogen_docs")
        self.chroma_persistence_path: Optional[str] = os.getenv("CHROMA_PERSISTENCE_PATH")
        self.chroma_k_results: int = int(os.getenv("CHROMA_K_RESULTS", "3"))
        self.chroma_score_threshold: float = float(os.getenv("CHROMA_SCORE_THRESHOLD", "0.4"))

        # Feature Flags
        self.enable_kubernetes: bool = os.getenv("ENABLE_KUBERNETES", "false").lower() == "true"
        self.enable_code_executor: bool = os.getenv("ENABLE_CODE_EXECUTOR", "false").lower() == "true"

        # Agent Framework Selection
        # Options: "autogen" or "claude" - default to "autogen"
        self.default_agent_type: str = os.getenv("DEFAULT_AGENT_TYPE", "autogen")

        # MCP Configuration
        default_mcp_config = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "mcp_config.yaml")
        self.mcp_config_path: str = os.getenv("MCP_CONFIG_PATH", default_mcp_config)

        # Session Management
        self.session_timeout_minutes: int = int(os.getenv("SESSION_TIMEOUT_MINUTES", "30"))
        self.auto_save_interval_seconds: int = int(os.getenv("AUTO_SAVE_INTERVAL_SECONDS", "300"))

        # Code Executor Configuration
        self.code_executor_image: str = os.getenv("CODE_EXECUTOR_IMAGE", "python:3.11-slim")
        self.code_executor_work_dir: str = os.getenv("CODE_EXECUTOR_WORK_DIR", "coding")

        # Token Limits
        self.max_total_tokens: int = int(os.getenv("MAX_TOTAL_TOKENS", "12000"))

        # CORS Configuration
        self.cors_origins: list[str] = os.getenv("CORS_ORIGINS", "*").split(",")

        # Logging
        self.log_level: str = os.getenv("LOG_LEVEL", "INFO")

    @property
    def sources_file(self) -> str:
        """Path to indexed sources file."""
        return os.path.join(self.data_store, "indexed_sources.json")

    @property
    def sessions_dir(self) -> str:
        """Path to sessions directory."""
        return os.path.join(self.data_store, "sessions")

    @property
    def chromadb_path(self) -> str:
        """Path to ChromaDB persistence directory."""
        if self.chroma_persistence_path:
            return self.chroma_persistence_path
        return os.path.join(self.data_store, ".chromadb_autogen")

    def __repr__(self) -> str:
        """String representation hiding sensitive data."""
        return (
            f"Settings(host={self.host}, port={self.port}, "
            f"model={self.openai_model}, "
            f"kubernetes={self.enable_kubernetes}, "
            f"code_executor={self.enable_code_executor})"
        )


@lru_cache()
def get_settings() -> Settings:
    """
    Get cached settings instance.

    This uses lru_cache to ensure we only create one Settings instance
    throughout the application lifecycle.

    Returns:
        Settings: The application settings instance
    """
    return Settings()
