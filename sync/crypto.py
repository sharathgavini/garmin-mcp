from __future__ import annotations

import base64
import json
import os
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ENCRYPTION_VERSION = 1
ALGORITHM = "AES-256-GCM"


class SessionCryptoError(ValueError):
    """Raised when encrypted session data cannot be decrypted."""


def encrypt_session(session: str, key: str | None = None) -> bytes:
    aes_key = _decode_key(key or _required_env("GARMIN_SESSION_KEY"))
    nonce = os.urandom(12)
    ciphertext = AESGCM(aes_key).encrypt(nonce, session.encode("utf-8"), None)
    payload = {
        "version": ENCRYPTION_VERSION,
        "algorithm": ALGORITHM,
        "nonce": base64.b64encode(nonce).decode("ascii"),
        "ciphertext": base64.b64encode(ciphertext).decode("ascii"),
    }
    return json.dumps(payload, sort_keys=True).encode("utf-8")


def decrypt_session(encrypted: bytes, key: str | None = None) -> str:
    try:
        payload: dict[str, Any] = json.loads(encrypted.decode("utf-8"))
        if payload.get("version") != ENCRYPTION_VERSION or payload.get("algorithm") != ALGORITHM:
            raise SessionCryptoError("Unsupported session encryption metadata.")
        nonce = base64.b64decode(payload["nonce"], validate=True)
        ciphertext = base64.b64decode(payload["ciphertext"], validate=True)
        plaintext = AESGCM(_decode_key(key or _required_env("GARMIN_SESSION_KEY"))).decrypt(nonce, ciphertext, None)
        return plaintext.decode("utf-8")
    except SessionCryptoError:
        raise
    except Exception as exc:
        raise SessionCryptoError("Encrypted session could not be decrypted.") from exc


def _decode_key(value: str) -> bytes:
    candidates = []
    stripped = value.strip()
    candidates.append(stripped.encode("utf-8"))
    try:
        candidates.append(base64.b64decode(stripped, validate=True))
    except Exception:
        pass
    try:
        padded = stripped + ("=" * (-len(stripped) % 4))
        candidates.append(base64.urlsafe_b64decode(padded))
    except Exception:
        pass
    try:
        candidates.append(bytes.fromhex(stripped))
    except ValueError:
        pass

    for candidate in candidates:
        if len(candidate) == 32:
            return candidate
    raise SessionCryptoError("GARMIN_SESSION_KEY must decode to exactly 32 bytes for AES-256-GCM.")


def _required_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SessionCryptoError(f"{name} is required for encrypted session storage.")
    return value
