"""Secrets at rest: AES-256-GCM, optionally envelope-encrypted with AWS KMS.

Ciphertext format (base64 JSON): {"v":1,"alg":"A256GCM","kid":"local"|<kms key>,
"dk": <encrypted data key, KMS only>, "iv": ..., "ct": ...}
"""

from __future__ import annotations

import base64
import json
import os
from functools import lru_cache
from typing import Any

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from martian.config import get_settings

_DEV_KEY = base64.b64encode(b"martian-dev-only-key-32-bytes!!!").decode()


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def _unb64(s: str) -> bytes:
    return base64.b64decode(s)


@lru_cache
def _local_key() -> bytes:
    s = get_settings()
    key = _unb64(s.encryption_key or _DEV_KEY)
    if len(key) != 32:
        raise RuntimeError("MARTIAN_ENCRYPTION_KEY must be 32 bytes, base64-encoded")
    return key


def _kms():  # pragma: no cover - exercised only with real AWS
    import boto3

    return boto3.client("kms")


def encrypt(data: dict[str, Any] | str) -> str:
    plaintext = json.dumps(data).encode() if not isinstance(data, str) else data.encode()
    s = get_settings()
    iv = os.urandom(12)
    if s.kms_key_id:  # pragma: no cover
        resp = _kms().generate_data_key(KeyId=s.kms_key_id, KeySpec="AES_256")
        key, dk, kid = resp["Plaintext"], _b64(resp["CiphertextBlob"]), s.kms_key_id
    else:
        key, dk, kid = _local_key(), None, "local"
    ct = AESGCM(key).encrypt(iv, plaintext, kid.encode())
    blob = {"v": 1, "alg": "A256GCM", "kid": kid, "dk": dk, "iv": _b64(iv), "ct": _b64(ct)}
    return _b64(json.dumps(blob).encode())


def decrypt(ciphertext: str) -> str:
    blob = json.loads(_unb64(ciphertext))
    if blob.get("dk"):  # pragma: no cover
        key = _kms().decrypt(CiphertextBlob=_unb64(blob["dk"]))["Plaintext"]
    else:
        key = _local_key()
    return AESGCM(key).decrypt(_unb64(blob["iv"]), _unb64(blob["ct"]), blob["kid"].encode()).decode()


def decrypt_json(ciphertext: str | None) -> dict[str, Any]:
    if not ciphertext:
        return {}
    return json.loads(decrypt(ciphertext))
