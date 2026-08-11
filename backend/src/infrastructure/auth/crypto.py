import os
import base64
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

# Derive a consistent 32-byte Fernet key from application secret or fallback
APP_SECRET = os.getenv("SECRET_KEY", "codelens_secure_fallback_encryption_key_2026")
SALT = b"codelens_static_crypto_salt"

kdf = PBKDF2HMAC(
    algorithm=hashes.SHA256(),
    length=32,
    salt=SALT,
    iterations=100_000,
)
FERNET_KEY = base64.urlsafe_b64encode(kdf.derive(APP_SECRET.encode()))
fernet = Fernet(FERNET_KEY)


def encrypt_api_key(plain_key: str) -> str:
    """Encrypt plain text API key into Fernet token string."""
    if not plain_key or not str(plain_key).strip():
        return ""
    return fernet.encrypt(plain_key.strip().encode()).decode()


def decrypt_api_key(encrypted_key: str) -> str:
    """Decrypt Fernet token back into plain text API key."""
    if not encrypted_key:
        return ""
    try:
        return fernet.decrypt(encrypted_key.encode()).decode()
    except Exception:
        return ""


def mask_api_key(plain_key: str) -> str:
    """Return masked representation: AIzaSy...X9aB"""
    if not plain_key or len(plain_key) < 10:
        return "••••••••"
    return f"{plain_key[:6]}...{plain_key[-4:]}"
