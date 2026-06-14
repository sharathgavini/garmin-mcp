from __future__ import annotations

"""Encrypted Garmin session restore/login helpers."""

import os
from pathlib import Path

from garminconnect import Garmin

from .crypto import SessionCryptoError, decrypt_session, encrypt_session

DEFAULT_SESSION_FILE = Path(os.environ.get("GARMIN_SESSION_FILE", ".garmin-session.enc"))


def load_session(session_file: Path = DEFAULT_SESSION_FILE) -> str | None:
    # Session restore should fail closed and allow login to retry.
    try:
        if not session_file.exists():
            return None
        return decrypt_session(session_file.read_bytes())
    except (OSError, SessionCryptoError, UnicodeDecodeError):
        return None


def save_session(client: Garmin, session_file: Path = DEFAULT_SESSION_FILE) -> bool:
    # Persist encrypted garth tokenstore with owner-only permissions.
    try:
        serialized = client.garth.dumps()
        session_file.parent.mkdir(parents=True, exist_ok=True)
        session_file.write_bytes(encrypt_session(serialized))
        session_file.chmod(0o600)
        return True
    except Exception:
        return False


def validate_session(client: Garmin) -> bool:
    try:
        client.garth.connectapi(client.garmin_connect_user_settings_url)
        return True
    except Exception:
        return False


def login_or_restore(
    *,
    email: str | None = None,
    password: str | None = None,
    session_file: Path = DEFAULT_SESSION_FILE,
    force_login: bool = False,
) -> Garmin:
    # Normal syncs should reuse encrypted sessions; force_login bypasses restore for first login/debugging.
    if not force_login:
        serialized = load_session(session_file)
        if serialized:
            restored = Garmin()
            try:
                restored.login(tokenstore=serialized)
                if validate_session(restored):
                    return restored
            except Exception:
                pass

    username = email or os.environ["GARMIN_EMAIL"]
    secret = password or os.environ["GARMIN_PASSWORD"]
    client = Garmin(username, secret)
    client.login()
    save_session(client, session_file)
    return client
