import base64
import secrets

import pytest

from sync.crypto import SessionCryptoError, decrypt_session, encrypt_session


# These tests protect encrypted Garmin session storage; plaintext must never leak.
def test_encrypt_decrypt_round_trip(monkeypatch):
    monkeypatch.setenv("GARMIN_SESSION_KEY", base64.b64encode(b"1" * 32).decode("ascii"))
    encrypted = encrypt_session("serialized-garth-token")

    assert b"serialized-garth-token" not in encrypted
    assert decrypt_session(encrypted) == "serialized-garth-token"


def test_decrypt_rejects_tampered_ciphertext(monkeypatch):
    monkeypatch.setenv("GARMIN_SESSION_KEY", base64.b64encode(b"1" * 32).decode("ascii"))
    encrypted = bytearray(encrypt_session("serialized-garth-token"))
    encrypted[-4] = ord("A") if encrypted[-4] != ord("A") else ord("B")

    with pytest.raises(SessionCryptoError):
        decrypt_session(bytes(encrypted))


def test_key_must_be_32_bytes(monkeypatch):
    monkeypatch.setenv("GARMIN_SESSION_KEY", "too-short")

    with pytest.raises(SessionCryptoError):
        encrypt_session("token")


def test_accepts_token_urlsafe_key_from_setup_instructions(monkeypatch):
    key = secrets.token_urlsafe(32)
    monkeypatch.setenv("GARMIN_SESSION_KEY", key)

    encrypted = encrypt_session("token")

    assert decrypt_session(encrypted) == "token"
