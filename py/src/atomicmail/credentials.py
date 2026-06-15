"""Credential and token file I/O."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol


@dataclass
class Credentials:
    apiKey: str
    inboxId: str
    authUrl: str
    apiUrl: str
    scryptSalt: str
    uploadUrl: str
    downloadUrl: str


@dataclass
class SkillFiles:
    credentialsFile: Path
    sessionFile: Path
    capabilityFile: Path


@dataclass
class CredentialArtifacts:
    credentials: Credentials | None = None
    session_jwt: str | None = None
    capability_jwt: str | None = None


class CredentialStore(Protocol):
    def load(self) -> CredentialArtifacts: ...

    def save(self, artifacts: CredentialArtifacts) -> None: ...

    def clear(self) -> None: ...


def default_files_from_out_dir(out_dir: str) -> SkillFiles:
    base = Path(out_dir).expanduser().resolve()
    return SkillFiles(
        credentialsFile=base / "credentials.json",
        sessionFile=base / "session.jwt",
        capabilityFile=base / "capability.jwt",
    )


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def serialize_credentials(creds: Credentials) -> str:
    return json.dumps(asdict(creds), indent=2) + "\n"


def parse_credentials_json(raw: str, *, path_for_errors: str = "credentials.json") -> Credentials:
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as err:
        raise ValueError(
            f"Credentials file '{path_for_errors}' is not valid JSON: {err}"
        ) from err

    required_fields = (
        "apiKey",
        "inboxId",
        "authUrl",
        "apiUrl",
        "scryptSalt",
        "uploadUrl",
        "downloadUrl",
    )
    for field in required_fields:
        value = obj.get(field) if isinstance(obj, dict) else None
        if not isinstance(value, str) or not value:
            raise ValueError(
                f"Credentials file '{path_for_errors}' missing required field: {field}"
            )

    return Credentials(**{key: obj[key] for key in required_fields})


def write_credentials(path: str | Path, creds: Credentials) -> None:
    file_path = Path(path)
    _ensure_parent(file_path)
    file_path.write_text(serialize_credentials(creds), encoding="utf-8")
    file_path.chmod(0o600)


def read_credentials(path: str | Path) -> Credentials:
    file_path = Path(path)
    try:
        raw = file_path.read_text(encoding="utf-8")
    except OSError as err:
        raise ValueError(
            f"Could not read credentials file '{file_path}': {err}. "
            "Did you run register first?"
        ) from err

    return parse_credentials_json(raw, path_for_errors=str(file_path))


def try_read_credentials(path: str | Path) -> Credentials | None:
    file_path = Path(path)
    if not file_path.exists():
        return None
    return read_credentials(file_path)


def write_jwt_file(path: str | Path, jwt: str) -> None:
    file_path = Path(path)
    _ensure_parent(file_path)
    file_path.write_text(jwt, encoding="utf-8")
    file_path.chmod(0o600)


def try_read_jwt_file(path: str | Path) -> str | None:
    file_path = Path(path)
    try:
        return file_path.read_text(encoding="utf-8").strip()
    except OSError:
        return None


def unlink_credential_artifacts(files: SkillFiles) -> None:
    for path in (files.credentialsFile, files.sessionFile, files.capabilityFile):
        try:
            path.unlink()
        except OSError:
            pass


@dataclass
class FilesystemCredentialStore:
    files: SkillFiles

    def load(self) -> CredentialArtifacts:
        return CredentialArtifacts(
            credentials=try_read_credentials(self.files.credentialsFile),
            session_jwt=try_read_jwt_file(self.files.sessionFile),
            capability_jwt=try_read_jwt_file(self.files.capabilityFile),
        )

    def save(self, artifacts: CredentialArtifacts) -> None:
        if artifacts.credentials is not None:
            write_credentials(self.files.credentialsFile, artifacts.credentials)
        if artifacts.session_jwt is not None:
            write_jwt_file(self.files.sessionFile, artifacts.session_jwt)
        if artifacts.capability_jwt is not None:
            write_jwt_file(self.files.capabilityFile, artifacts.capability_jwt)

    def clear(self) -> None:
        unlink_credential_artifacts(self.files)
