"""Configuration resolution for auth/api/credential defaults."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping

from .constants import (
    DEFAULT_API_URL,
    DEFAULT_AUTH_URL,
    DEFAULT_POW_SCRYPT_SALT_HEX,
)
from .credentials import SkillFiles, default_files_from_out_dir, try_read_credentials

ConfigSource = Literal["credentials-file", "env", "mixed", "defaults"]


@dataclass
class ResolvedAgentConfig:
    authUrl: str
    apiUrl: str
    scryptSalt: str
    apiKey: str | None
    inboxId: str | None
    credentialDir: str
    files: SkillFiles
    source: ConfigSource


def resolve_credential_dir() -> str:
    from_env = os.getenv("ATOMIC_MAIL_CREDENTIALS_DIR")
    if from_env:
        return from_env

    home = os.getenv("HOME") or os.getenv("USERPROFILE")
    if not home:
        raise ValueError(
            "Cannot determine default credential directory: HOME and USERPROFILE "
            "are both unset. Set ATOMIC_MAIL_CREDENTIALS_DIR explicitly."
        )
    home_base = home.rstrip("/\\")
    return f"{home_base}/.atomicmail"


def expand_credential_dir_input(dir_value: str | None = None) -> str:
    raw = dir_value or os.getenv("ATOMIC_MAIL_CREDENTIALS_DIR") or "~/.atomicmail"
    if raw == "~":
        return str(Path.home())
    return str(Path(raw).expanduser().resolve())


def _normalize_url(url: str) -> str:
    return url.rstrip("/")


def _pick_env(env: Mapping[str, str], key: str) -> str | None:
    value = env.get(key)
    return value if value else None


def resolve_agent_config_from_env(
    env: Mapping[str, str] | None = None,
    credential_dir: str | None = None,
) -> ResolvedAgentConfig:
    current_env = env or os.environ
    resolved_credential_dir = (
        expand_credential_dir_input(credential_dir)
        if credential_dir is not None
        else resolve_credential_dir()
    )
    files = default_files_from_out_dir(resolved_credential_dir)
    file_creds = try_read_credentials(files.credentialsFile)

    env_auth_url = _pick_env(current_env, "ATOMIC_MAIL_AUTH_URL")
    env_api_url = _pick_env(current_env, "ATOMIC_MAIL_API_URL")
    env_salt = _pick_env(current_env, "ATOMIC_MAIL_SCRYPT_SALT")
    env_api_key = _pick_env(current_env, "ATOMIC_MAIL_API_KEY")

    auth_url = env_auth_url or (file_creds.authUrl if file_creds else None) or DEFAULT_AUTH_URL
    api_url = env_api_url or (file_creds.apiUrl if file_creds else None) or DEFAULT_API_URL
    scrypt_salt = (
        env_salt
        or (file_creds.scryptSalt if file_creds else None)
        or DEFAULT_POW_SCRYPT_SALT_HEX
    )
    api_key = env_api_key or (file_creds.apiKey if file_creds else None)
    inbox_id = file_creds.inboxId if file_creds else None

    using_file = file_creds is not None
    using_env = any((env_auth_url, env_api_url, env_salt, env_api_key))

    if using_file and using_env:
        source: ConfigSource = "mixed"
    elif using_file:
        source = "credentials-file"
    elif using_env:
        source = "env"
    else:
        source = "defaults"

    return ResolvedAgentConfig(
        authUrl=_normalize_url(auth_url),
        apiUrl=_normalize_url(api_url),
        scryptSalt=scrypt_salt,
        apiKey=api_key,
        inboxId=inbox_id,
        credentialDir=resolved_credential_dir,
        files=files,
        source=source,
    )
