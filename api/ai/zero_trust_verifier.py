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

logger = logging.getLogger(__name__)

# Configuration
CLOCK_SKEW_TOLERANCE = 60  # seconds
NONCE_EXPIRY = 300  # 5 minutes
MESSAGE_TIMESTAMP_WINDOW = 60  # seconds


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
    """

    def __init__(self, backend_url: Optional[str] = None):
        self.backend_url = backend_url or os.getenv('SLAR_BACKEND_URL', '')

        # Cache of instance public keys
        self._instance_cache: Dict[str, InstanceInfo] = {}

        # Active verified sessions
        self._sessions: Dict[str, VerifiedSession] = {}

        # Used nonces for replay prevention (cert_id -> set of nonces)
        self._used_nonces: Dict[str, Set[str]] = {}

        # Nonce timestamps for cleanup
        self._nonce_timestamps: Dict[str, float] = {}

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
        """Register an instance's public key"""
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
        existing_session = self._sessions.get(session_id)
        if existing_session and existing_session.cert_id == cert.id:
            # Reconnection with same certificate - reuse session
            # This preserves nonce state for replay attack prevention
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

        self._sessions[session_id] = session
        
        # Only initialize nonces if not already tracked for this certificate
        if cert.id not in self._used_nonces:
            self._used_nonces[cert.id] = set()

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
        # 1. Get session
        session = self._sessions.get(session_id)
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

        # 5. Check nonce (replay prevention)
        nonce = payload.get('nonce')
        if not nonce:
            return False, "Missing nonce", None

        nonce_key = f"{session.cert_id}:{nonce}"
        if nonce in self._used_nonces.get(session.cert_id, set()):
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

        # 7. Mark nonce as used
        if session.cert_id not in self._used_nonces:
            self._used_nonces[session.cert_id] = set()
        self._used_nonces[session.cert_id].add(nonce)
        self._nonce_timestamps[nonce_key] = current_time

        # 8. Check permission for message type
        msg_type = payload.get('type', '')
        data = payload.get('data', {})

        if msg_type == 'chat_message' and not session.has_permission('chat'):
            return False, "Permission denied: chat", None
        if msg_type == 'tool_approval' and not session.has_permission('tools'):
            return False, "Permission denied: tools", None

        return True, "OK", data

    def get_session(self, session_id: str) -> Optional[VerifiedSession]:
        """Get verified session by ID"""
        return self._sessions.get(session_id)

    def revoke_session(self, session_id: str) -> bool:
        """Revoke a session"""
        if session_id in self._sessions:
            session = self._sessions.pop(session_id)
            # Clean up nonces for this certificate
            if session.cert_id in self._used_nonces:
                del self._used_nonces[session.cert_id]
            logger.info(f"Revoked session {session_id}")
            return True
        return False

    def cleanup_expired_nonces(self):
        """Clean up expired nonces to prevent memory bloat"""
        current_time = time.time()
        expired_keys = [
            key for key, timestamp in self._nonce_timestamps.items()
            if current_time - timestamp > NONCE_EXPIRY
        ]

        for key in expired_keys:
            del self._nonce_timestamps[key]
            # Also remove from used_nonces sets
            parts = key.split(':', 1)
            if len(parts) == 2:
                cert_id, nonce = parts
                if cert_id in self._used_nonces:
                    self._used_nonces[cert_id].discard(nonce)

        if expired_keys:
            logger.debug(f"Cleaned up {len(expired_keys)} expired nonces")

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
