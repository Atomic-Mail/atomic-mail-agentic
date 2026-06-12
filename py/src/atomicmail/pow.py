"""PoW scrypt solver compatible with TypeScript implementation."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Callable

SCRYPT_N = 16_384
SCRYPT_R = 8
SCRYPT_P = 1
POW_HASH_BYTES = 64
HAS_NATIVE_SCRYPT = hasattr(hashlib, "scrypt")
NATIVE_SCRYPT_REQUIRED_MESSAGE = (
    "hashlib.scrypt is required for PoW solving, but is unavailable in this Python build."
)


@dataclass
class PowSolution:
    powHex: str
    nonce: str


def has_leading_zero_bits(hash_bytes: bytes, bits: int) -> bool:
    if bits > len(hash_bytes) * 8:
        return False

    full_bytes = bits // 8
    remaining_bits = bits % 8

    for i in range(full_bytes):
        if hash_bytes[i] != 0:
            return False

    if remaining_bits:
        mask = (0xFF << (8 - remaining_bits)) & 0xFF
        if (hash_bytes[full_bytes] & mask) != 0:
            return False

    return True


def scrypt_hash(data: str, salt: str) -> bytes:
    if not HAS_NATIVE_SCRYPT:
        raise RuntimeError(NATIVE_SCRYPT_REQUIRED_MESSAGE)

    return hashlib.scrypt(
        data.encode("utf-8"),
        salt=salt.encode("utf-8"),
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=POW_HASH_BYTES,
    )


def solve_pow(
    challenge: str,
    difficulty: int,
    salt: str,
    on_progress: Callable[[int], None] | None = None,
) -> PowSolution:
    nonce = 0
    while True:
        digest = scrypt_hash(f"{challenge}:{nonce}", salt)
        if has_leading_zero_bits(digest, difficulty):
            return PowSolution(powHex=digest.hex(), nonce=str(nonce))
        nonce += 1
        if on_progress and nonce % 64 == 0:
            on_progress(nonce)
