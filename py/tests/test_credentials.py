from __future__ import annotations

from pathlib import Path

from atomicmail.credentials import (
    Credentials,
    default_files_from_out_dir,
    read_credentials,
    try_read_credentials,
    try_read_jwt_file,
    unlink_credential_artifacts,
    write_credentials,
    write_jwt_file,
)


def _sample_credentials() -> Credentials:
    return Credentials(
        apiKey="sample-api-key",
        inboxId="alice@atomicmail.ai",
        authUrl="https://auth.atomicmail.ai",
        apiUrl="https://api.atomicmail.ai",
        scryptSalt="salt-hex",
        uploadUrl="https://api.atomicmail.ai/upload/{accountId}/",
        downloadUrl="https://api.atomicmail.ai/download/{accountId}/{blobId}/{name}",
    )


def test_default_files_from_out_dir(tmp_path: Path) -> None:
    files = default_files_from_out_dir(str(tmp_path))
    assert files.credentialsFile == tmp_path / "credentials.json"
    assert files.sessionFile == tmp_path / "session.jwt"
    assert files.capabilityFile == tmp_path / "capability.jwt"


def test_write_and_read_credentials_roundtrip(tmp_path: Path) -> None:
    target = tmp_path / "nested" / "credentials.json"
    creds = _sample_credentials()
    write_credentials(target, creds)

    loaded = read_credentials(target)
    assert loaded == creds


def test_read_credentials_requires_fields(tmp_path: Path) -> None:
    target = tmp_path / "credentials.json"
    target.write_text('{"apiKey":"x"}', encoding="utf-8")

    try:
        read_credentials(target)
    except ValueError as err:
        assert "missing required field" in str(err)
    else:
        raise AssertionError("Expected read_credentials to fail")


def test_try_read_credentials_missing_file(tmp_path: Path) -> None:
    assert try_read_credentials(tmp_path / "missing.json") is None


def test_write_and_try_read_jwt_file(tmp_path: Path) -> None:
    target = tmp_path / "session.jwt"
    write_jwt_file(target, "header.payload.sig\n")
    assert try_read_jwt_file(target) == "header.payload.sig"


def test_unlink_credential_artifacts(tmp_path: Path) -> None:
    files = default_files_from_out_dir(str(tmp_path))
    write_credentials(files.credentialsFile, _sample_credentials())
    write_jwt_file(files.sessionFile, "session")
    write_jwt_file(files.capabilityFile, "capability")

    unlink_credential_artifacts(files)

    assert not files.credentialsFile.exists()
    assert not files.sessionFile.exists()
    assert not files.capabilityFile.exists()
