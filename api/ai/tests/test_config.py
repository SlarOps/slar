"""
Tests for the config module.
"""

import os
import pytest
from config.settings import Settings, get_settings


def test_settings_defaults():
    """Test that Settings initializes with correct default values."""
    settings = Settings()

    assert settings.host == "0.0.0.0"
    assert settings.port == 8002
    assert settings.openai_model == "gpt-4o"
    assert settings.chroma_collection_name == "autogen_docs"
    assert settings.chroma_k_results == 3
    assert settings.chroma_score_threshold == 0.4
    assert settings.enable_kubernetes is False
    assert settings.enable_code_executor is False
    assert settings.max_total_tokens == 12000


def test_settings_environment_variables(monkeypatch):
    """Test that Settings reads from environment variables."""
    monkeypatch.setenv("PORT", "9000")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4-turbo")
    monkeypatch.setenv("ENABLE_KUBERNETES", "true")
    monkeypatch.setenv("CHROMA_K_RESULTS", "5")

    settings = Settings()

    assert settings.port == 9000
    assert settings.openai_model == "gpt-4-turbo"
    assert settings.enable_kubernetes is True
    assert settings.chroma_k_results == 5


def test_settings_properties():
    """Test Settings computed properties."""
    settings = Settings()

    # Check that properties return expected paths
    assert "data/indexed_sources.json" in settings.sources_file or "indexed_sources.json" in settings.sources_file
    assert "sessions" in settings.sessions_dir
    assert ".chromadb_autogen" in settings.chromadb_path


def test_get_settings_singleton():
    """Test that get_settings returns the same instance."""
    settings1 = get_settings()
    settings2 = get_settings()

    assert settings1 is settings2


def test_settings_repr():
    """Test Settings string representation."""
    settings = Settings()
    repr_str = repr(settings)

    assert "Settings" in repr_str
    assert settings.openai_model in repr_str
    # Ensure sensitive data like API key is not in repr
    assert "OPENAI_API_KEY" not in repr_str
