from __future__ import annotations

import pytest

from atomicmail.pow import (
    HAS_NATIVE_SCRYPT,
    NATIVE_SCRYPT_REQUIRED_MESSAGE,
    has_leading_zero_bits,
    scrypt_hash,
    solve_pow,
)
from atomicmail.shared_assets import read_shared_json


def test_solve_pow_matches_shared_fixture_vectors() -> None:
    if not HAS_NATIVE_SCRYPT:
        pytest.skip("Native hashlib.scrypt unavailable in this interpreter.")

    fixture = read_shared_json("fixtures/pow_vectors.json")
    for vector in fixture["vectors"]:
        solved = solve_pow(
            challenge=vector["challenge"],
            difficulty=vector["difficulty"],
            salt=vector["salt"],
        )
        assert solved.nonce == vector["nonce"]
        assert solved.powHex == vector["powHex"]


def test_shared_pow_vectors_satisfy_difficulty() -> None:
    if not HAS_NATIVE_SCRYPT:
        pytest.skip("Native hashlib.scrypt unavailable in this interpreter.")

    fixture = read_shared_json("fixtures/pow_vectors.json")
    for vector in fixture["vectors"]:
        digest = scrypt_hash(
            f'{vector["challenge"]}:{vector["nonce"]}',
            vector["salt"],
        )
        assert has_leading_zero_bits(digest, vector["difficulty"])


def test_progress_callback_fires(monkeypatch) -> None:
    progress_nonces: list[int] = []
    salt = "0b980734412c292d6549110276b604ab1dea4883bd460d77d1b984adf8bca083"

    def fake_scrypt_hash(data: str, _salt: str) -> bytes:
        nonce = int(data.rsplit(":", 1)[1])
        if nonce >= 64:
            return bytes([0] + [255] * 63)
        return bytes([255] * 64)

    monkeypatch.setattr("atomicmail.pow.scrypt_hash", fake_scrypt_hash)
    solution = solve_pow(
        challenge="fixture-progress",
        difficulty=1,
        salt=salt,
        on_progress=progress_nonces.append,
    )

    assert solution.nonce == "64"
    assert progress_nonces == [64]


def test_scrypt_hash_requires_native_scrypt(monkeypatch) -> None:
    monkeypatch.setattr("atomicmail.pow.HAS_NATIVE_SCRYPT", False)
    with pytest.raises(RuntimeError, match=NATIVE_SCRYPT_REQUIRED_MESSAGE):
        scrypt_hash("challenge:0", "salt")
