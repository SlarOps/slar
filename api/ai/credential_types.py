"""
Credential type definitions for credential management.

Credentials are stored as raw text/JSON in Vault.
Types are used only for categorization and UI metadata.
"""

from enum import Enum


class CredentialType(str, Enum):
    """Supported credential types (used for categorization only)."""
    GENERIC_API_KEY = "generic_api_key"


CREDENTIAL_TYPE_METADATA = {
    CredentialType.GENERIC_API_KEY: {
        "category": "generic",
        "name": "Credential",
        "icon": "🔐",
        "description": "Generic secret (token, JSON, connection string, key, etc.)",
        "doc_url": None,
    },
}
