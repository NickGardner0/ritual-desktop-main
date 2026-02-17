import unittest
import sys
from pathlib import Path

from cryptography.fernet import Fernet

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.token_crypto import ENCRYPTED_PREFIX, TokenCrypto


class TokenCryptoTests(unittest.TestCase):
    def test_encrypt_then_decrypt_round_trip(self):
        key = Fernet.generate_key().decode("utf-8")
        crypto = TokenCrypto(key=key)

        plaintext = "secret-token-value"
        ciphertext = crypto.encrypt(plaintext)

        self.assertTrue(ciphertext.startswith(ENCRYPTED_PREFIX))
        self.assertEqual(crypto.decrypt(ciphertext), plaintext)

    def test_decrypt_legacy_plaintext(self):
        crypto = TokenCrypto(key=Fernet.generate_key().decode("utf-8"))
        self.assertEqual(crypto.decrypt("legacy-plaintext"), "legacy-plaintext")

    def test_encrypt_requires_key(self):
        crypto = TokenCrypto(key="")
        with self.assertRaises(RuntimeError):
            crypto.encrypt("value")


if __name__ == "__main__":
    unittest.main()
