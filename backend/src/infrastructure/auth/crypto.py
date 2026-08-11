import os
import base64
import logging
from dotenv import load_dotenv

load_dotenv()

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from src.domain.constants import PBKDF2_ITERATIONS

logger = logging.getLogger(__name__)

# NOTE: Decoupled encryption secret. Rotating SECRET_KEY for JWT signing MUST NOT alter
# ENCRYPTION_KEY, as doing so would render existing encrypted stored API keys unreadable.
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", os.getenv("FERNET_SECRET", "")).strip()
if not ENCRYPTION_KEY:
    raise RuntimeError("ENCRYPTION_KEY environment variable is missing or empty. Refusing to boot with insecure fallback.")

SALT = b"codelens_static_crypto_salt"

kdf = PBKDF2HMAC(
    algorithm=hashes.SHA256(),
    length=32,
    salt=SALT,
    iterations=PBKDF2_ITERATIONS,
)
FERNET_KEY = base64.urlsafe_b64encode(kdf.derive(ENCRYPTION_KEY.encode()))
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
    except Exception as e:
        logger.warning(f"Decryption failed: invalid key or payload ({e})")
        return ""


def mask_api_key(plain_key: str) -> str:
    """Return masked representation showing at most first 4 and last 4 characters."""
    if not plain_key or len(plain_key) < 10:
        return "••••••••"
    return f"{plain_key[:4]}...{plain_key[-4:]}"

