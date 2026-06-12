"""Credential and token file I/O."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path


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


def default_files_from_out_dir(out_dir: str) -> SkillFiles:
    base = Path(out_dir).expanduser().resolve()
    return SkillFiles(
        credentialsFile=base / "credentials.json",
        sessionFile=base / "session.jwt",
        capabilityFile=base / "capability.jwt",
    )


def _ensure_parent(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)


def write_credentials(path: str | Path, creds: Credentials) -> None:
    file_path = Path(path)
    _ensure_parent(file_path)
    file_path.write_text(json.dumps(asdict(creds), indent=2) + "\n", encoding="utf-8")
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

    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as err:
        raise ValueError(
            f"Credentials file '{file_path}' is not valid JSON: {err}"
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
                f"Credentials file '{file_path}' missing required field: {field}"
            )

    return Credentials(**{key: obj[key] for key in required_fields})


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
