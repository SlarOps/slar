"""
Zero-Trust Message Verifier for AI Agent

This module implements per-message verification for the AI Agent WebSocket.
Every message from mobile clients is cryptographically signed and verified.

Security Features:
- Ed25519/ECDSA signature verification per message
- Nonce-based replay attack prevention
- Timestamp validation (clock skew tolerance)
- Device certificate chain validation
- Permission enforcement
- PostgreSQL persistence for sessions and nonces (survives restarts)

Flow:
1. Mobile sends signed authentication with device certificate
2. Server verifies certificate was signed by trusted instance
3. Every subsequent message is signed by device's private key
4. Server verifies each message against device's public key
"""

import json
import time
import hashlib
import logging
from typing import Dict, List, Optional, Tuple, Set
from dataclasses import dataclass, field
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, ed25519
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature, encode_dss_signature
from cryptography.hazmat.backends import default_backend
from cryptography.exceptions import InvalidSignature
import base64
import os
import uuid
import httpx
from datetime import datetime, timedelta

# Import database utility
try:
    from .database_util import get_db_connection, execute_query
except ImportError:
    from database_util import get_db_connection, execute_query

logger = logging.getLogger(__name__)

# Configuration
CLOCK_SKEW_TOLERANCE = 60  # seconds
NONCE_EXPIRY = 300  # 5 minutes
MESSAGE_TIMESTAMP_WINDOW = 60  # seconds
SESSION_EXPIRY_HOURS = 24 * 7  # 7 days - sessions last longer than certificates


@dataclass
class DeviceCertificate:
    """Device certificate issued by self-hosted instance"""
    id: str
    device_public_key: str  # Base64 encoded
    user_id: str
    instance_id: str
    permissions: List[str]
    issued_at: int
    expires_at: int
    instance_signature: str  # Hex encoded

    @classmethod
    def from_dict(cls, data: dict) -> 'DeviceCertificate':
        return cls(
            id=data.get('id', ''),
            device_public_key=data.get('device_public_key', ''),
            user_id=data.get('user_id', ''),
            instance_id=data.get('instance_id', ''),
            permissions=data.get('permissions', ['chat']),
            issued_at=data.get('issued_at', 0),
            expires_at=data.get('expires_at', 0),
            instance_signature=data.get('instance_signature', ''),
        )

    def is_expired(self) -> bool:
        return time.time() > self.expires_at

    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions


@dataclass
class VerifiedSession:
    """Verified session after certificate validation"""
    session_id: str
    cert_id: str
    user_id: str
    instance_id: str
    permissions: List[str]
    device_public_key: bytes  # Decoded public key
    created_at: float = field(default_factory=time.time)

    def has_permission(self, permission: str) -> bool:
        return permission in self.permissions


@dataclass
class InstanceInfo:
    """Cached instance public key"""
    instance_id: str
    public_key_pem: str
    public_key: ec.EllipticCurvePublicKey
    last_updated: float


class ZeroTrustVerifier:
    """
    Zero-Trust message verifier for AI Agent WebSocket connections.

    Every message is independently verified - no implicit trust after auth.
    Sessions and nonces are persisted to PostgreSQL for durability across restarts.
    """

    def __init__(self, backend_url: Optional[str] = None):
        self.backend_url = backend_url or os.getenv('SLAR_BACKEND_URL', '')

        # In-memory cache of instance public keys (loaded from DB on demand)
        self._instance_cache: Dict[str, InstanceInfo] = {}

        # In-memory cache of active sessions (loaded from DB on demand)
        # This is a performance optimization - DB is source of truth
        self._sessions_cache: Dict[str, VerifiedSession] = {}

        # Load instance keys from database on startup
        self._load_instance_keys_from_db()

    def _load_instance_keys_from_db(self):
        """Load cached instance public keys from database"""
        try:
            rows = execute_query(
                "SELECT instance_id, public_key_pem, last_updated FROM agent_instance_keys",
                fetch="all"
            )
            for row in rows or []:
                try:
                    public_key = serialization.load_pem_public_key(
                        row['public_key_pem'].encode(),
                        backend=default_backend()
                    )
                    if isinstance(public_key, ec.EllipticCurvePublicKey):
                        self._instance_cache[row['instance_id']] = InstanceInfo(
                            instance_id=row['instance_id'],
                            public_key_pem=row['public_key_pem'],
                            public_key=public_key,
                            last_updated=row['last_updated'].timestamp() if row['last_updated'] else time.time()
                        )
                        logger.info(f"Loaded instance key from DB: {row['instance_id']}")
                except Exception as e:
                    logger.warning(f"Failed to load instance key {row['instance_id']}: {e}")
        except Exception as e:
            logger.warning(f"Could not load instance keys from DB (table may not exist): {e}")

    def _save_instance_key_to_db(self, instance_id: str, public_key_pem: str):
        """Save instance public key to database"""
        try:
            execute_query(
                """
                INSERT INTO agent_instance_keys (instance_id, public_key_pem, last_updated)
                VALUES (%s, %s, NOW())
                ON CONFLICT (instance_id) DO UPDATE SET
                    public_key_pem = EXCLUDED.public_key_pem,
                    last_updated = NOW()
                """,
                (instance_id, public_key_pem),
                fetch="none"
            )
            logger.info(f"Saved instance key to DB: {instance_id}")
        except Exception as e:
            logger.warning(f"Could not save instance key to DB: {e}")

    def _save_session_to_db(self, session: VerifiedSession):
        """Save session to database for persistence"""
        try:
            expires_at = datetime.now() + timedelta(hours=SESSION_EXPIRY_HOURS)
            execute_query(
                """
                INSERT INTO agent_sessions (session_id, cert_id, user_id, instance_id, permissions, device_public_key, created_at, expires_at, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, NOW(), %s, TRUE)
                ON CONFLICT (session_id) DO UPDATE SET
                    last_activity_at = NOW(),
                    is_active = TRUE
                """,
                (
                    session.session_id,
                    session.cert_id,
                    session.user_id,
                    session.instance_id,
                    session.permissions,
                    base64.b64encode(session.device_public_key).decode(),
                    expires_at
                ),
                fetch="none"
            )
            logger.info(f"Saved session to DB: {session.session_id}")
        except Exception as e:
            logger.warning(f"Could not save session to DB: {e}")

    def _load_session_from_db(self, session_id: str) -> Optional[VerifiedSession]:
        """Load session from database"""
        try:
            row = execute_query(
                """
                SELECT session_id, cert_id, user_id, instance_id, permissions, device_public_key, created_at
                FROM agent_sessions
                WHERE session_id = %s AND is_active = TRUE AND expires_at > NOW()
                """,
                (session_id,),
                fetch="one"
            )
            if row:
                # Update last activity
                execute_query(
                    "UPDATE agent_sessions SET last_activity_at = NOW() WHERE session_id = %s",
                    (session_id,),
                    fetch="none"
                )
                return VerifiedSession(
                    session_id=str(row['session_id']),
                    cert_id=row['cert_id'],
                    user_id=str(row['user_id']),
                    instance_id=row['instance_id'],
                    permissions=row['permissions'] or ['chat'],
                    device_public_key=base64.b64decode(row['device_public_key']),
                    created_at=row['created_at'].timestamp() if row['created_at'] else time.time()
                )
        except Exception as e:
            logger.warning(f"Could not load session from DB: {e}")
        return None

    def _check_nonce_in_db(self, cert_id: str, nonce: str) -> bool:
        """Check if nonce was already used (returns True if already used)"""
        try:
            row = execute_query(
                "SELECT 1 FROM agent_nonces WHERE cert_id = %s AND nonce = %s",
                (cert_id, nonce),
                fetch="one"
            )
            return row is not None
        except Exception as e:
            logger.warning(f"Could not check nonce in DB: {e}")
            return False

    def _save_nonce_to_db(self, cert_id: str, nonce: str):
        """Save used nonce to database"""
        try:
            execute_query(
                "INSERT INTO agent_nonces (cert_id, nonce, used_at) VALUES (%s, %s, NOW()) ON CONFLICT DO NOTHING",
                (cert_id, nonce),
                fetch="none"
            )
        except Exception as e:
            logger.warning(f"Could not save nonce to DB: {e}")

    async def fetch_instance_public_key(self, instance_id: str) -> Optional[str]:
        """Fetch instance public key from self-hosted backend"""
        if not self.backend_url:
            logger.warning("No backend URL configured, cannot fetch instance key")
            return None

        try:
            # Try /identity/public-key first (direct endpoint)
            url = f"{self.backend_url}/identity/public-key"
            logger.info(f"🔑 Fetching instance public key from: {url}")

            async with httpx.AsyncClient() as client:
                response = await client.get(url, timeout=10.0)
                logger.info(f"🔑 Response status: {response.status_code}")

                if response.status_code == 200:
                    data = response.json()
                    logger.info(f"🔑 Response data keys: {list(data.keys())}")
                    public_key = data.get('public_key')
                    if public_key:
                        logger.info(f"🔑 Got public key (length: {len(public_key)})")
                        return public_key

                # Fallback: try /agent/config (returns instance_public_key)
                url = f"{self.backend_url}/agent/config"
                logger.info(f"🔑 Fallback: Fetching from: {url}")
                response = await client.get(url, timeout=10.0)
                logger.info(f"🔑 Fallback response status: {response.status_code}")

                if response.status_code == 200:
                    data = response.json()
                    logger.info(f"🔑 Fallback response data keys: {list(data.keys())}")
                    public_key = data.get('instance_public_key')
                    if public_key:
                        logger.info(f"🔑 Got public key from fallback (length: {len(public_key)})")
                        return public_key

                logger.error(f"Failed to fetch public key from both endpoints")
                return None
        except Exception as e:
            logger.error(f"Error fetching instance public key: {e}", exc_info=True)
            return None

    def register_instance(self, instance_id: str, public_key_pem: str) -> bool:
        """Register an instance's public key and persist to database"""
        try:
            # Parse PEM public key
            public_key = serialization.load_pem_public_key(
                public_key_pem.encode(),
                backend=default_backend()
            )

            if not isinstance(public_key, ec.EllipticCurvePublicKey):
                logger.error("Public key is not ECDSA")
                return False

            self._instance_cache[instance_id] = InstanceInfo(
                instance_id=instance_id,
                public_key_pem=public_key_pem,
                public_key=public_key,
                last_updated=time.time()
            )

            # Persist to database for durability across restarts
            self._save_instance_key_to_db(instance_id, public_key_pem)

            logger.info(f"Registered instance {instance_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to register instance: {e}")
            return False

    async def verify_certificate(self, cert: DeviceCertificate) -> Tuple[bool, str]:
        """
        Verify device certificate was signed by the instance.

        Returns: (is_valid, error_message)
        """
        logger.info(f"📜 Verifying certificate: {cert.id}")
        logger.info(f"📜 Instance ID: {cert.instance_id}")
        logger.info(f"📜 User ID: {cert.user_id}")
        logger.info(f"📜 Expires at: {cert.expires_at}, current: {time.time()}")

        # 1. Check expiration
        if cert.is_expired():
            logger.warning(f"📜 Certificate expired!")
            return False, "Certificate expired"

        # 2. Get instance public key
        instance = self._instance_cache.get(cert.instance_id)
        logger.info(f"📜 Instance in cache: {instance is not None}")

        if not instance:
            # Try to fetch from backend
            logger.info(f"📜 Fetching instance public key from backend...")
            public_key_pem = await self.fetch_instance_public_key(cert.instance_id)
            if public_key_pem:
                self.register_instance(cert.instance_id, public_key_pem)
                instance = self._instance_cache.get(cert.instance_id)
            else:
                logger.warning(f"📜 Could not fetch instance public key!")

            if not instance:
                return False, f"Unknown instance: {cert.instance_id}"

        # 3. Build canonical payload for verification
        cert_payload = {
            "id": cert.id,
            "device_public_key": cert.device_public_key,
            "user_id": cert.user_id,
            "instance_id": cert.instance_id,
            "permissions": cert.permissions,
            "issued_at": cert.issued_at,
            "expires_at": cert.expires_at,
        }
        canonical_json = self._canonical_json(cert_payload)
        logger.info(f"📜 Canonical JSON for verification: {canonical_json[:100]}...")

        # 4. Verify ECDSA signature
        # Go produces Raw format (R || S), but cryptography library expects DER format
        try:
            logger.info(f"📜 Signature hex: {cert.instance_signature[:40]}...")
            signature_bytes = bytes.fromhex(cert.instance_signature)
            logger.info(f"📜 Signature bytes length: {len(signature_bytes)}")

            # Convert Raw (R || S) format to DER format
            # P-256 curve has 32-byte R and S values (64 bytes total in raw format)
            if len(signature_bytes) == 64:
                r = int.from_bytes(signature_bytes[:32], byteorder='big')
                s = int.from_bytes(signature_bytes[32:], byteorder='big')
                # Encode to DER format that cryptography library expects
                der_signature = encode_dss_signature(r, s)
                logger.info(f"📜 Converted Raw to DER format (64 -> {len(der_signature)} bytes)")
            else:
                # Assume it's already in DER format
                der_signature = signature_bytes
                logger.info(f"📜 Using signature as-is (already DER format?)")

            instance.public_key.verify(
                der_signature,
                canonical_json.encode(),
                ec.ECDSA(hashes.SHA256())
            )
            logger.info(f"📜 ✅ Signature verified successfully!")
        except InvalidSignature:
            logger.warning(f"📜 ❌ Invalid certificate signature!")
            return False, "Invalid certificate signature"
        except Exception as e:
            logger.error(f"📜 ❌ Signature verification error: {e}", exc_info=True)
            return False, f"Signature verification error: {e}"

        return True, "OK"

    async def authenticate(
        self,
        cert_dict: dict,
        session_id: Optional[str] = None
    ) -> Tuple[Optional[VerifiedSession], str]:
        """
        Authenticate a device with its certificate.

        Returns: (session, error_message)
        """
        logger.info(f"🔐 Starting authentication...")
        logger.info(f"🔐 Certificate dict keys: {list(cert_dict.keys())}")

        cert = DeviceCertificate.from_dict(cert_dict)
        logger.info(f"🔐 Parsed certificate: id={cert.id}, user={cert.user_id}")

        # Verify certificate
        is_valid, error = await self.verify_certificate(cert)
        if not is_valid:
            logger.warning(f"🔐 ❌ Certificate verification failed: {error}")
            return None, error

        logger.info(f"🔐 ✅ Certificate verified!")

        # Decode device public key
        try:
            device_key_bytes = base64.b64decode(cert.device_public_key)
            logger.info(f"🔐 Device public key bytes length: {len(device_key_bytes)}")
        except Exception as e:
            logger.error(f"🔐 ❌ Invalid device public key encoding: {e}")
            return None, f"Invalid device public key encoding: {e}"

        # Handle session ID
        if not session_id:
            session_id = str(uuid.uuid4())
        else:
            # Validate provided session_id is a valid UUID
            try:
                uuid.UUID(session_id)
            except ValueError:
                logger.warning(f"🔐 Invalid session_id format, generating new UUID")
                session_id = str(uuid.uuid4())

        # Check if session already exists (reconnection case)
        # First check in-memory cache, then database
        existing_session = self._sessions_cache.get(session_id)
        if not existing_session:
            # Try to load from database (survives server restart)
            existing_session = self._load_session_from_db(session_id)
            if existing_session:
                self._sessions_cache[session_id] = existing_session

        if existing_session and existing_session.cert_id == cert.id:
            # Reconnection with same certificate - reuse session
            logger.info(f"🔐 ✅ Reconnected to existing session {session_id}")
            return existing_session, "OK"

        # Create new session
        session = VerifiedSession(
            session_id=session_id,
            cert_id=cert.id,
            user_id=cert.user_id,
            instance_id=cert.instance_id,
            permissions=cert.permissions,
            device_public_key=device_key_bytes,
        )

        # Save to in-memory cache
        self._sessions_cache[session_id] = session

        # Persist to database for durability across restarts
        self._save_session_to_db(session)

        logger.info(f"🔐 ✅ Authenticated session {session_id} for user {cert.user_id}")
        return session, "OK"

    def verify_message(
        self,
        signed_message: dict,
        session_id: str
    ) -> Tuple[bool, str, Optional[dict]]:
        """
        Verify a signed message from the client.

        Returns: (is_valid, error_message, payload_data)
        """
        # 1. Get session (from cache first, then database)
        session = self._sessions_cache.get(session_id)
        if not session:
            # Try to load from database
            session = self._load_session_from_db(session_id)
            if session:
                self._sessions_cache[session_id] = session

        if not session:
            return False, "Session not found", None

        # 2. Extract payload and signature
        payload = signed_message.get('payload')
        signature_hex = signed_message.get('signature')

        if not payload or not signature_hex:
            return False, "Missing payload or signature", None

        # 3. Verify certificate ID matches session
        if payload.get('cert_id') != session.cert_id:
            return False, "Certificate ID mismatch", None

        # 4. Check timestamp
        msg_timestamp = payload.get('timestamp', 0) / 1000  # Convert from ms
        current_time = time.time()

        if abs(current_time - msg_timestamp) > MESSAGE_TIMESTAMP_WINDOW:
            return False, "Message timestamp out of range", None

        # 5. Check nonce (replay prevention) - check database
        nonce = payload.get('nonce')
        if not nonce:
            return False, "Missing nonce", None

        if self._check_nonce_in_db(session.cert_id, nonce):
            return False, "Nonce already used (replay attack)", None

        # 6. Verify Ed25519 signature
        try:
            canonical_json = self._canonical_json(payload)
            logger.info(f"📜 Canonical JSON for verification: {canonical_json[:200]}...")
            logger.info(f"📜 Signature hex: {signature_hex[:64]}...")
            signature_bytes = bytes.fromhex(signature_hex)

            # Create Ed25519 public key from bytes
            public_key = ed25519.Ed25519PublicKey.from_public_bytes(
                session.device_public_key
            )

            public_key.verify(signature_bytes, canonical_json.encode())

        except InvalidSignature:
            return False, "Invalid message signature", None
        except Exception as e:
            return False, f"Signature verification error: {e}", None

        # 7. Mark nonce as used - persist to database
        self._save_nonce_to_db(session.cert_id, nonce)

        # 8. Check permission for message type
        msg_type = payload.get('type', '')
        data = payload.get('data', {})

        if msg_type == 'chat_message' and not session.has_permission('chat'):
            return False, "Permission denied: chat", None
        if msg_type == 'tool_approval' and not session.has_permission('tools'):
            return False, "Permission denied: tools", None

        return True, "OK", data

    def get_session(self, session_id: str) -> Optional[VerifiedSession]:
        """Get verified session by ID (from cache or database)"""
        # Check cache first
        session = self._sessions_cache.get(session_id)
        if session:
            return session

        # Try to load from database
        session = self._load_session_from_db(session_id)
        if session:
            self._sessions_cache[session_id] = session
        return session

    def revoke_session(self, session_id: str) -> bool:
        """Revoke a session (from cache and database)"""
        # Remove from cache
        session = self._sessions_cache.pop(session_id, None)

        # Deactivate in database
        try:
            execute_query(
                "UPDATE agent_sessions SET is_active = FALSE WHERE session_id = %s",
                (session_id,),
                fetch="none"
            )
            logger.info(f"Revoked session {session_id}")
            return True
        except Exception as e:
            logger.warning(f"Could not revoke session in DB: {e}")
            return session is not None

    def cleanup_expired_nonces(self):
        """Clean up expired nonces and sessions from database"""
        try:
            # Clean up expired nonces (older than 5 minutes)
            execute_query(
                "DELETE FROM agent_nonces WHERE used_at < NOW() - INTERVAL '5 minutes'",
                fetch="none"
            )

            # Clean up expired sessions
            execute_query(
                "DELETE FROM agent_sessions WHERE expires_at < NOW() OR is_active = FALSE",
                fetch="none"
            )

            # Also clear cache entries for expired sessions
            expired_session_ids = []
            for session_id, session in list(self._sessions_cache.items()):
                # Check if session is still valid in DB
                row = execute_query(
                    "SELECT 1 FROM agent_sessions WHERE session_id = %s AND is_active = TRUE AND expires_at > NOW()",
                    (session_id,),
                    fetch="one"
                )
                if not row:
                    expired_session_ids.append(session_id)

            for session_id in expired_session_ids:
                self._sessions_cache.pop(session_id, None)

            logger.debug(f"Cleanup: removed {len(expired_session_ids)} expired sessions from cache")
        except Exception as e:
            logger.warning(f"Cleanup error: {e}")

    def _canonical_json(self, data: dict) -> str:
        """
        Convert dict to canonical JSON (sorted keys, no spaces).
        Must match the encoding used by mobile client.
        """
        return json.dumps(data, sort_keys=True, separators=(',', ':'))


# Singleton instance
_verifier: Optional[ZeroTrustVerifier] = None


def get_verifier() -> ZeroTrustVerifier:
    """Get or create the global verifier instance"""
    global _verifier
    if _verifier is None:
        _verifier = ZeroTrustVerifier()
    return _verifier


def init_verifier(backend_url: Optional[str] = None) -> ZeroTrustVerifier:
    """Initialize the global verifier with configuration"""
    global _verifier
    _verifier = ZeroTrustVerifier(backend_url=backend_url)
    return _verifier
