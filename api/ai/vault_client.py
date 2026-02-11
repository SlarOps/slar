"""
HashiCorp Vault Client for Secret Management

This module provides a simple interface to interact with HashiCorp Vault
for storing and retrieving secrets, particularly for git credentials.

Features:
- Automatic Kubernetes authentication (when running in K8s)
- Fallback to token-based auth (for local development)
- Git credential storage and retrieval
- Support for both authenticated and public repository access
"""

import os
import logging
from typing import Optional, Dict, Any
from pathlib import Path

try:
    import hvac
    HVAC_AVAILABLE = True
except ImportError:
    HVAC_AVAILABLE = False
    logging.warning("⚠️  hvac library not available. Install with: pip install hvac")

logger = logging.getLogger(__name__)


class VaultClient:
    """
    HashiCorp Vault client with automatic authentication.
    
    Supports:
    - Kubernetes authentication (automatic in K8s pods)
    - Token-based authentication (for local dev with VAULT_TOKEN env var)
    - Graceful degradation (returns None if Vault unavailable)
    """
    
    def __init__(
        self,
        vault_addr: Optional[str] = None,
        vault_role: Optional[str] = None,
        vault_token: Optional[str] = None
    ):
        """
        Initialize Vault client.
        
        Args:
            vault_addr: Vault server address (default: VAULT_ADDR env var or http://vault:8200)
            vault_role: Kubernetes auth role (default: VAULT_ROLE env var or 'slar-ai-agent')
            vault_token: Vault token for direct auth (default: VAULT_TOKEN env var)
        """
        self.vault_addr = vault_addr or os.getenv("VAULT_ADDR", "http://vault:8200")
        self.vault_role = vault_role or os.getenv("VAULT_ROLE", "slar-ai-agent")
        self.vault_token = vault_token or os.getenv("VAULT_TOKEN")
        
        self.client: Optional[hvac.Client] = None
        self.enabled = os.getenv("VAULT_ENABLED", "true").lower() in ("true", "1", "yes")
        
        if not HVAC_AVAILABLE:
            logger.warning("⚠️  Vault client disabled: hvac library not installed")
            self.enabled = False
            return
        
        if not self.enabled:
            logger.info("ℹ️  Vault client disabled via VAULT_ENABLED=false")
            return
        
        self._authenticate()
    
    def _authenticate(self):
        """Authenticate with Vault using available method."""
        try:
            self.client = hvac.Client(url=self.vault_addr)
            
            # Method 1: Direct token (for local development)
            if self.vault_token:
                self.client.token = self.vault_token
                if self.client.is_authenticated():
                    logger.info(f"✅ Vault authenticated with token to {self.vault_addr}")
                    return
                else:
                    logger.warning("⚠️  Vault token authentication failed")
            
            # Method 2: Kubernetes service account (for K8s pods)
            k8s_token_path = Path("/var/run/secrets/kubernetes.io/serviceaccount/token")
            if k8s_token_path.exists():
                try:
                    jwt = k8s_token_path.read_text().strip()
                    self.client.auth.kubernetes.login(
                        role=self.vault_role,
                        jwt=jwt
                    )
                    if self.client.is_authenticated():
                        logger.info(f"✅ Vault authenticated via Kubernetes to {self.vault_addr}")
                        return
                except Exception as e:
                    logger.warning(f"⚠️  Kubernetes auth failed: {e}")
            
            # No auth method worked
            logger.warning(
                "⚠️  Could not authenticate with Vault. "
                "Set VAULT_TOKEN env var or run in Kubernetes with service account."
            )
            self.client = None
            self.enabled = False
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Vault client: {e}")
            self.client = None
            self.enabled = False
    
    def is_available(self) -> bool:
        """Check if Vault is available and authenticated."""
        return self.enabled and self.client is not None and self.client.is_authenticated()
    
    def get_git_credential(
        self,
        user_id: str,
        credential_name: str = "default_github_pat"
    ) -> Optional[Dict[str, str]]:
        """
        Retrieve git credentials from Vault.
        
        Args:
            user_id: User ID (used in secret path)
            credential_name: Name of the credential (default: 'default_github_pat')
        
        Returns:
            Dict with 'username' and 'token', or None if not found or Vault unavailable
        """
        if not self.is_available():
            logger.debug("Vault not available, skipping credential retrieval")
            return None
        
        try:
            # Secret path: secret/data/slar/users/{user_id}/git/{credential_name}
            secret_path = f"slar/users/{user_id}/git/{credential_name}"
            
            logger.debug(f"📖 Reading git credential from Vault: {secret_path}")
            
            # Read secret from KV v2 engine
            secret_response = self.client.secrets.kv.v2.read_secret_version(
                path=secret_path,
                mount_point="secret"
            )
            
            if not secret_response or "data" not in secret_response:
                logger.debug(f"No credential found at {secret_path}")
                return None
            
            data = secret_response["data"]["data"]
            
            # Validate required fields
            if "username" not in data or "token" not in data:
                logger.warning(f"⚠️  Incomplete credential at {secret_path} (missing username or token)")
                return None
            
            logger.info(f"✅ Retrieved git credential for user {user_id}")
            return {
                "username": data["username"],
                "token": data["token"],
                "provider": data.get("provider", "github")
            }
        
        except hvac.exceptions.InvalidPath:
            logger.debug(f"Git credential not found in Vault: {secret_path}")
            return None
        except Exception as e:
            logger.error(f"❌ Failed to retrieve git credential from Vault: {e}")
            return None
    
    def store_git_credential(
        self,
        user_id: str,
        username: str,
        token: str,
        credential_name: str = "default_github_pat",
        provider: str = "github"
    ) -> bool:
        """
        Store git credentials in Vault.
        
        Args:
            user_id: User ID
            username: Git username
            token: Git token/PAT
            credential_name: Name of the credential
            provider: Git provider (github, gitlab, bitbucket)
        
        Returns:
            True if stored successfully, False otherwise
        """
        if not self.is_available():
            logger.warning("⚠️  Cannot store credential: Vault not available")
            return False
        
        try:
            secret_path = f"slar/users/{user_id}/git/{credential_name}"
            
            logger.debug(f"💾 Storing git credential to Vault: {secret_path}")
            
            # Write secret to KV v2 engine
            self.client.secrets.kv.v2.create_or_update_secret(
                path=secret_path,
                secret={
                    "username": username,
                    "token": token,
                    "provider": provider
                },
                mount_point="secret"
            )
            
            logger.info(f"✅ Stored git credential for user {user_id}")
            return True
        
        except Exception as e:
            logger.error(f"❌ Failed to store git credential to Vault: {e}")
            return False
    
    def delete_git_credential(
        self,
        user_id: str,
        credential_name: str = "default_github_pat"
    ) -> bool:
        """
        Delete git credentials from Vault.
        
        Args:
            user_id: User ID
            credential_name: Name of the credential
        
        Returns:
            True if deleted successfully, False otherwise
        """
        if not self.is_available():
            logger.warning("⚠️  Cannot delete credential: Vault not available")
            return False
        
        try:
            secret_path = f"slar/users/{user_id}/git/{credential_name}"
            
            logger.debug(f"🗑️  Deleting git credential from Vault: {secret_path}")
            
            # Delete metadata (soft delete)
            self.client.secrets.kv.v2.delete_metadata_and_all_versions(
                path=secret_path,
                mount_point="secret"
            )
            
            logger.info(f"✅ Deleted git credential for user {user_id}")
            return True
        
        except Exception as e:
            logger.error(f"❌ Failed to delete git credential from Vault: {e}")
            return False
    
    def list_git_credentials(self, user_id: str) -> list[str]:
        """
        List all git credentials for a user.
        
        Args:
            user_id: User ID
        
        Returns:
            List of credential names
        """
        if not self.is_available():
            return []
        
        try:
            secret_path = f"slar/users/{user_id}/git"
            
            response = self.client.secrets.kv.v2.list_secrets(
                path=secret_path,
                mount_point="secret"
            )
            
            if response and "data" in response and "keys" in response["data"]:
                credentials = response["data"]["keys"]
                logger.info(f"📋 Found {len(credentials)} git credentials for user {user_id}")
                return credentials
            
            return []
        
        except hvac.exceptions.InvalidPath:
            logger.debug(f"No git credentials found for user {user_id}")
            return []
        except Exception as e:
            logger.error(f"❌ Failed to list git credentials: {e}")
            return []
    
    # ==========================================
    # Generic Credential Methods
    # ==========================================
    
    def store_credential(
        self,
        user_id: str,
        credential_type: str,
        credential_name: str,
        data: dict,
        metadata: Optional[dict] = None
    ) -> bool:
        """
        Store a generic credential in Vault.
        
        Args:
            user_id: User ID
            credential_type: Type of credential (e.g., 'github_pat', 'postgres_connection')
            credential_name: Name of this credential instance
            data: Credential data (validated by caller)
            metadata: Optional metadata (description, tags, etc.)
        
        Returns:
            True if stored successfully, False otherwise
        """
        if not self.is_available():
            logger.warning("⚠️  Cannot store credential: Vault not available")
            return False
        
        try:
            # Path: secret/slar/users/{user_id}/credentials/{credential_type}/{credential_name}
            secret_path = f"slar/users/{user_id}/credentials/{credential_type}/{credential_name}"
            
            logger.debug(f"💾 Storing credential to Vault: {secret_path}")
            
            # Combine data with metadata
            secret_data = {
                "data": data,
                "metadata": metadata or {},
                "credential_type": credential_type,
                "created_at": __import__("datetime").datetime.utcnow().isoformat()
            }
            
            # Write to KV v2 engine
            self.client.secrets.kv.v2.create_or_update_secret(
                path=secret_path,
                secret=secret_data,
                mount_point="secret"
            )
            
            logger.info(f"✅ Stored {credential_type} credential for user {user_id}: {credential_name}")
            return True
        
        except Exception as e:
            logger.error(f"❌ Failed to store credential to Vault: {e}")
            return False
    
    def get_credential(
        self,
        user_id: str,
        credential_type: str,
        credential_name: str
    ) -> Optional[dict]:
        """
        Retrieve a generic credential from Vault.
        
        Args:
            user_id: User ID
            credential_type: Type of credential
            credential_name: Name of credential
        
        Returns:
            Dict with credential data and metadata, or None if not found
        """
        if not self.is_available():
            logger.debug("Vault not available, skipping credential retrieval")
            return None
        
        try:
            secret_path = f"slar/users/{user_id}/credentials/{credential_type}/{credential_name}"
            
            logger.debug(f"📖 Reading credential from Vault: {secret_path}")
            
            # Read from KV v2 engine
            secret_response = self.client.secrets.kv.v2.read_secret_version(
                path=secret_path,
                mount_point="secret"
            )
            
            if not secret_response or "data" not in secret_response:
                logger.debug(f"No credential found at {secret_path}")
                return None
            
            response_data = secret_response["data"]["data"]
            
            logger.info(f"✅ Retrieved {credential_type} credential for user {user_id}: {credential_name}")
            return response_data
        
        except hvac.exceptions.InvalidPath:
            logger.debug(f"Credential not found in Vault: {secret_path}")
            return None
        except Exception as e:
            logger.error(f"❌ Failed to retrieve credential from Vault: {e}")
            return None
    
    def list_credentials(
        self,
        user_id: str,
        credential_type: Optional[str] = None
    ) -> list[dict]:
        """
        List all credentials for a user, optionally filtered by type.
        
        Args:
            user_id: User ID
            credential_type: Optional credential type filter
        
        Returns:
            List of credential info dicts (name, type, metadata only - no sensitive data)
        """
        if not self.is_available():
            return []
        
        try:
            base_path = f"slar/users/{user_id}/credentials"
            
            if credential_type:
                # List specific type
                type_path = f"{base_path}/{credential_type}"
                response = self.client.secrets.kv.v2.list_secrets(
                    path=type_path,
                    mount_point="secret"
                )
                
                if response and "data" in response and "keys" in response["data"]:
                    return [
                        {
                            "name": name.rstrip("/"),
                            "type": credential_type,
                            "path": f"{type_path}/{name.rstrip('/')}"
                        }
                        for name in response["data"]["keys"]
                    ]
                return []
            else:
                # List all types first
                types_response = self.client.secrets.kv.v2.list_secrets(
                    path=base_path,
                    mount_point="secret"
                )
                
                if not types_response or "data" not in types_response:
                    return []
                
                credential_types = types_response["data"].get("keys", [])
                all_credentials = []

                # For each type, list credentials
                # Note: Vault KV v2 list returns directory names with trailing slash
                for cred_type_raw in credential_types:
                    cred_type = cred_type_raw.rstrip("/")
                    type_path = f"{base_path}/{cred_type}"
                    try:
                        creds_response = self.client.secrets.kv.v2.list_secrets(
                            path=type_path,
                            mount_point="secret"
                        )

                        if creds_response and "data" in creds_response:
                            for name_raw in creds_response["data"].get("keys", []):
                                name = name_raw.rstrip("/")
                                all_credentials.append({
                                    "name": name,
                                    "type": cred_type,
                                    "path": f"{type_path}/{name}"
                                })
                    except hvac.exceptions.InvalidPath:
                        continue
                
                logger.info(f"📋 Found {len(all_credentials)} credentials for user {user_id}")
                return all_credentials
        
        except hvac.exceptions.InvalidPath:
            logger.debug(f"No credentials found for user {user_id}")
            return []
        except Exception as e:
            logger.error(f"❌ Failed to list credentials: {e}")
            return []
    
    def delete_credential(
        self,
        user_id: str,
        credential_type: str,
        credential_name: str
    ) -> bool:
        """
        Delete a credential from Vault.
        
        Args:
            user_id: User ID
            credential_type: Type of credential
            credential_name: Name of credential
        
        Returns:
            True if deleted successfully, False otherwise
        """
        if not self.is_available():
            logger.warning("⚠️  Cannot delete credential: Vault not available")
            return False
        
        try:
            secret_path = f"slar/users/{user_id}/credentials/{credential_type}/{credential_name}"
            
            logger.debug(f"🗑️  Deleting credential from Vault: {secret_path}")
            
            # Delete metadata (soft delete)
            self.client.secrets.kv.v2.delete_metadata_and_all_versions(
                path=secret_path,
                mount_point="secret"
            )
            
            logger.info(f"✅ Deleted {credential_type} credential for user {user_id}: {credential_name}")
            return True
        
        except Exception as e:
            logger.error(f"❌ Failed to delete credential from Vault: {e}")
            return False


# Singleton instance
_vault_client: Optional[VaultClient] = None


def get_vault_client() -> VaultClient:
    """
    Get or create singleton Vault client.
    
    Returns:
        VaultClient instance
    """
    global _vault_client
    
    if _vault_client is None:
        _vault_client = VaultClient()
    
    return _vault_client


# ==========================================
# Convenience Functions - Git Credentials
# ==========================================

def get_git_credential(user_id: str, credential_name: str = "default_github_pat") -> Optional[Dict[str, str]]:
    """Retrieve git credentials from Vault."""
    return get_vault_client().get_git_credential(user_id, credential_name)


def store_git_credential(
    user_id: str,
    username: str,
    token: str,
    credential_name: str = "default_github_pat",
    provider: str = "github"
) -> bool:
    """Store git credentials in Vault."""
    return get_vault_client().store_git_credential(
        user_id, username, token, credential_name, provider
    )


# ==========================================
# Convenience Functions - Generic Credentials
# ==========================================

def store_credential(
    user_id: str,
    credential_type: str,
    credential_name: str,
    data: dict,
    metadata: Optional[dict] = None
) -> bool:
    """Store a generic credential in Vault."""
    return get_vault_client().store_credential(
        user_id, credential_type, credential_name, data, metadata
    )


def get_credential(
    user_id: str,
    credential_type: str,
    credential_name: str
) -> Optional[dict]:
    """Retrieve a generic credential from Vault."""
    return get_vault_client().get_credential(
        user_id, credential_type, credential_name
    )


def list_credentials(
    user_id: str,
    credential_type: Optional[str] = None
) -> list[dict]:
    """List all credentials for a user, optionally filtered by type."""
    return get_vault_client().list_credentials(user_id, credential_type)


def delete_credential(
    user_id: str,
    credential_type: str,
    credential_name: str
) -> bool:
    """Delete a credential from Vault."""
    return get_vault_client().delete_credential(
        user_id, credential_type, credential_name
    )
