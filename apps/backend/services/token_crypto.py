"""
Token encryption helpers for sensitive integration secrets.
"""

from __future__ import annotations

import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

ENCRYPTED_PREFIX = "enc:v1:"


class TokenCrypto:
    """Encrypt/decrypt tokens stored in the database."""

    def __init__(self, key: Optional[str] = None):
        normalized_key = key.strip() if isinstance(key, str) else key
        raw_key = normalized_key if key is not None else os.getenv("TOKEN_ENCRYPTION_KEY")
        self._fernet: Optional[Fernet] = None
        self._explicit_empty_key = key is not None and not normalized_key

        if raw_key:
            self._fernet = Fernet(raw_key.encode("utf-8"))

    @property
    def enabled(self) -> bool:
        return self._fernet is not None

    def encrypt(self, plaintext: Optional[str]) -> Optional[str]:
        if plaintext is None:
            return None

        if plaintext.startswith(ENCRYPTED_PREFIX):
            return plaintext

        if not self._fernet:
            if self._explicit_empty_key:
                raise RuntimeError(
                    "TOKEN_ENCRYPTION_KEY is required to encrypt integration tokens."
                )
            # No encryption key configured - store as plaintext.
            # This is acceptable for local/development environments.
            # In production, set TOKEN_ENCRYPTION_KEY for encrypted storage.
            return plaintext

        encrypted = self._fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")
        return f"{ENCRYPTED_PREFIX}{encrypted}"

    def decrypt(self, ciphertext: Optional[str]) -> Optional[str]:
        if ciphertext is None:
            return None

        if not ciphertext.startswith(ENCRYPTED_PREFIX):
            # Plaintext token (no encryption key was set, or legacy row).
            return ciphertext

        if not self._fernet:
            raise RuntimeError(
                "TOKEN_ENCRYPTION_KEY is required to decrypt stored integration tokens. "
                "Set it in your .env or re-connect the integration."
            )

        token = ciphertext[len(ENCRYPTED_PREFIX) :]
        try:
            return self._fernet.decrypt(token.encode("utf-8")).decode("utf-8")
        except InvalidToken as exc:
            raise RuntimeError("Stored token cannot be decrypted with current key.") from exc


token_crypto = TokenCrypto()
