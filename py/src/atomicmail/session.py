"""Stateful auth/session service with register flow."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Mapping
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from .auth_http import fetch_capability, perform_pow_and_session
from .config import ResolvedAgentConfig, resolve_agent_config_from_env
from .credentials import (
    Credentials,
    SkillFiles,
    try_read_credentials,
    try_read_jwt_file,
    unlink_credential_artifacts,
    write_credentials,
    write_jwt_file,
)
from .jwt_utils import (
    CAPABILITY_SAFETY_MARGIN_MS,
    SESSION_SAFETY_MARGIN_MS,
    decode_jwt_payload,
    is_jwt_expired,
)

JMAP_MAIL_URN = "urn:ietf:params:jmap:mail"
JMAP_BLOB_URN = "urn:ietf:params:jmap:blob"


@dataclass
class RegisterResult:
    inbox: str
    accountId: str
    apiKey: str | None = None
    idempotent: bool | None = None


@dataclass
class AgentSessionConfig:
    authUrl: str
    apiUrl: str
    scryptSalt: str
    apiKey: str | None
    inboxId: str | None
    credentialDir: str
    files: SkillFiles


def inbox_local_part(inbox_id: str) -> str:
    i = inbox_id.find("@")
    if i < 0:
        return _normalize_username(inbox_id)
    return _normalize_username(inbox_id[:i])


class AgentSession:
    def __init__(self, cfg: AgentSessionConfig) -> None:
        self._auth_url = cfg.authUrl.rstrip("/")
        self.apiUrl = cfg.apiUrl.rstrip("/")
        self._scrypt_salt = cfg.scryptSalt
        self._api_key = cfg.apiKey
        self._inbox_id = cfg.inboxId
        self.credentialDir = cfg.credentialDir
        self.files = cfg.files

        self._session_jwt: str | None = None
        self._capability_jwt: str | None = None
        self._cached_mail_account_id: str | None = None
        self._cached_upload_url: str | None = None
        self._cached_download_url: str | None = None
        self._cached_jmap_post_url: str | None = None
        self._cached_jmap_session: dict[str, object] | None = None

    @classmethod
    def create(cls, cfg: AgentSessionConfig) -> AgentSession:
        session = cls(cfg)
        session._load_from_disk()
        return session

    @classmethod
    def from_resolved_config(cls, config: ResolvedAgentConfig) -> AgentSession:
        return cls.create(
            AgentSessionConfig(
                authUrl=config.authUrl,
                apiUrl=config.apiUrl,
                scryptSalt=config.scryptSalt,
                apiKey=config.apiKey,
                inboxId=config.inboxId,
                credentialDir=config.credentialDir,
                files=config.files,
            )
        )

    @property
    def has_api_key(self) -> bool:
        return bool(self._api_key)

    @property
    def current_inbox_id(self) -> str | None:
        return self._inbox_id

    @property
    def current_upload_url(self) -> str | None:
        return self._cached_upload_url

    @property
    def current_download_url(self) -> str | None:
        return self._cached_download_url

    def register(self, username: str, *, forced: bool = False) -> RegisterResult:
        want = _normalize_username(username)
        if len(want) < 5 or len(want) > 21:
            raise ValueError("Username must be 5-21 characters.")

        if self.has_api_key and not self._inbox_id:
            raise ValueError(
                "Cannot register: an API key is configured but inboxId is unknown. "
                "Fix credentials.json or unset ATOMIC_MAIL_API_KEY before registering."
            )

        if self.has_api_key and self._inbox_id:
            have = inbox_local_part(self._inbox_id)
            if have == want:
                return RegisterResult(
                    inbox=self._inbox_id,
                    accountId=self.get_primary_mail_account_id(),
                    idempotent=True,
                )
            if not forced:
                raise ValueError(
                    "Register refused because credentials already belong to "
                    f'"{self._inbox_id}" and requested username is "{want}". '
                    "Use a separate credential directory to register another account "
                    "without replacing this one. If you want to replace credentials "
                    "in this directory, retry with forced=True."
                )

            unlink_credential_artifacts(self.files)
            self._api_key = None
            self._inbox_id = None
            self._session_jwt = None
            self._capability_jwt = None
            self.invalidate_jmap_session_cache()

        session = perform_pow_and_session(
            auth_url=self._auth_url,
            scrypt_salt=self._scrypt_salt,
            username=username,
        )
        if not session.apiKey:
            raise ValueError("Signup did not return an apiKey - this indicates a server bug.")

        self._api_key = session.apiKey
        self._session_jwt = session.sessionJWT
        write_jwt_file(self.files.sessionFile, self._session_jwt)

        capability = fetch_capability(self._auth_url, self._session_jwt)
        self._capability_jwt = capability
        write_jwt_file(self.files.capabilityFile, capability)

        claims = decode_jwt_payload(capability)
        inbox_id = claims.get("inboxId")
        if not isinstance(inbox_id, str) or not inbox_id:
            raise ValueError("Capability JWT missing inboxId claim after signup.")
        self._inbox_id = inbox_id

        self.invalidate_jmap_session_cache()
        account_id = self.get_primary_mail_account_id()

        if (
            not self._cached_upload_url
            or not self._cached_download_url
            or not self._cached_jmap_post_url
        ):
            raise ValueError(
                "JMAP session did not provide uploadUrl, downloadUrl, or apiUrl."
            )

        write_credentials(
            self.files.credentialsFile,
            Credentials(
                apiKey=self._api_key,
                inboxId=self._inbox_id,
                authUrl=self._auth_url,
                apiUrl=self.apiUrl,
                scryptSalt=self._scrypt_salt,
                uploadUrl=self._cached_upload_url,
                downloadUrl=self._cached_download_url,
            ),
        )

        return RegisterResult(
            inbox=self._inbox_id,
            accountId=account_id,
            apiKey=self._api_key,
        )

    def login_with_api_key(self, api_key: str) -> RegisterResult:
        normalized_api_key = api_key.strip()
        if not normalized_api_key:
            raise ValueError("API key must be a non-empty string.")

        session = perform_pow_and_session(
            auth_url=self._auth_url,
            scrypt_salt=self._scrypt_salt,
            api_key=normalized_api_key,
        )
        self._api_key = normalized_api_key
        self._session_jwt = session.sessionJWT
        write_jwt_file(self.files.sessionFile, self._session_jwt)

        capability = fetch_capability(self._auth_url, self._session_jwt)
        self._capability_jwt = capability
        write_jwt_file(self.files.capabilityFile, capability)

        claims = decode_jwt_payload(capability)
        inbox_id = claims.get("inboxId")
        if not isinstance(inbox_id, str) or not inbox_id:
            raise ValueError("Capability JWT missing inboxId claim after API-key login.")
        self._inbox_id = inbox_id

        self.invalidate_jmap_session_cache()
        account_id = self.get_primary_mail_account_id()

        if (
            not self._cached_upload_url
            or not self._cached_download_url
            or not self._cached_jmap_post_url
        ):
            raise ValueError(
                "JMAP session did not provide uploadUrl, downloadUrl, or apiUrl."
            )

        write_credentials(
            self.files.credentialsFile,
            Credentials(
                apiKey=self._api_key,
                inboxId=self._inbox_id,
                authUrl=self._auth_url,
                apiUrl=self.apiUrl,
                scryptSalt=self._scrypt_salt,
                uploadUrl=self._cached_upload_url,
                downloadUrl=self._cached_download_url,
            ),
        )

        return RegisterResult(
            inbox=self._inbox_id,
            accountId=account_id,
        )

    def get_primary_mail_account_id(self) -> str:
        if (
            self._cached_mail_account_id
            and self._cached_upload_url
            and self._cached_download_url
            and self._cached_jmap_post_url
            and self._cached_jmap_session
        ):
            return self._cached_mail_account_id

        self._refresh_jmap_session_data()
        if not self._cached_mail_account_id:
            raise ValueError("JMAP session missing primary mail account id.")
        return self._cached_mail_account_id

    def get_jmap_post_url(self) -> str:
        if self._cached_jmap_post_url:
            return self._cached_jmap_post_url
        self._refresh_jmap_session_data()
        if not self._cached_jmap_post_url:
            raise ValueError("JMAP session missing apiUrl.")
        return self._cached_jmap_post_url

    def get_capability_token(self) -> str:
        if self._capability_jwt and not is_jwt_expired(
            self._capability_jwt, CAPABILITY_SAFETY_MARGIN_MS
        ):
            return self._capability_jwt

        self._ensure_session()
        if not self._session_jwt:
            raise ValueError("Internal: ensure_session left session JWT unset.")

        cap = fetch_capability(self._auth_url, self._session_jwt)
        self._capability_jwt = cap
        write_jwt_file(self.files.capabilityFile, cap)

        try:
            claims = decode_jwt_payload(cap)
            inbox = claims.get("inboxId")
            if isinstance(inbox, str) and inbox:
                self._inbox_id = inbox
        except Exception:
            pass

        return cap

    def get_blob_upload_limits_for_account(self, account_id: str) -> dict[str, int | None] | None:
        if not account_id:
            return None
        if self._cached_jmap_session is None:
            self.get_primary_mail_account_id()
        if self._cached_jmap_session is None:
            return None
        return extract_blob_upload_limits(self._cached_jmap_session, account_id)

    def invalidate_jmap_session_cache(self) -> None:
        self._cached_mail_account_id = None
        self._cached_upload_url = None
        self._cached_download_url = None
        self._cached_jmap_post_url = None
        self._cached_jmap_session = None

    def _load_from_disk(self) -> None:
        self._session_jwt = try_read_jwt_file(self.files.sessionFile)
        self._capability_jwt = try_read_jwt_file(self.files.capabilityFile)
        disk = try_read_credentials(self.files.credentialsFile)
        if disk:
            self._api_key = self._api_key or disk.apiKey
            self._inbox_id = self._inbox_id or disk.inboxId
            self._cached_upload_url = disk.uploadUrl
            self._cached_download_url = disk.downloadUrl

    def _ensure_session(self) -> None:
        if self._session_jwt and not is_jwt_expired(
            self._session_jwt, SESSION_SAFETY_MARGIN_MS
        ):
            return
        if not self._api_key:
            raise ValueError(
                "No API key configured and no valid session on disk. Run register first, "
                "set ATOMIC_MAIL_API_KEY, or place credentials.json in the credential directory."
            )

        result = perform_pow_and_session(
            auth_url=self._auth_url,
            scrypt_salt=self._scrypt_salt,
            api_key=self._api_key,
        )
        self._session_jwt = result.sessionJWT
        self._capability_jwt = None
        self.invalidate_jmap_session_cache()
        write_jwt_file(self.files.sessionFile, self._session_jwt)

    def _refresh_jmap_session_data(self) -> None:
        cap = self.get_capability_token()
        session = fetch_jmap_well_known(self.apiUrl, cap)
        self._cached_jmap_session = session
        self._cached_mail_account_id = extract_primary_mail_account_id(session)
        upload_url, download_url = extract_blob_endpoints(session)
        self._cached_upload_url = upload_url
        self._cached_download_url = download_url
        self._cached_jmap_post_url = extract_jmap_api_url(session)


def register(
    username: str | None = None,
    *,
    api_key: str | None = None,
    credentials_dir: str | None = None,
    forced: bool = False,
    env: Mapping[str, str] | None = None,
) -> RegisterResult:
    if bool(username) == bool(api_key):
        raise ValueError(
            "Provide exactly one of username (new account) or api_key (existing account login)."
        )
    if api_key and forced:
        raise ValueError("forced is only supported when registering with username.")

    config = resolve_agent_config_from_env(env, credential_dir=credentials_dir)
    session = AgentSession.from_resolved_config(config)
    if username:
        return session.register(username, forced=forced)
    if not api_key:
        raise ValueError(
            "Internal: expected api_key to be set when username is not provided."
        )
    return session.login_with_api_key(api_key)


def fetch_jmap_well_known(api_url: str, capability_jwt: str) -> dict[str, object]:
    base = api_url.rstrip("/")
    req = Request(
        f"{base}/.well-known/jmap",
        method="GET",
        headers={"Authorization": f"Bearer {capability_jwt}"},
    )
    try:
        with urlopen(req) as response:
            text = response.read().decode("utf-8")
            status = int(response.getcode())
    except HTTPError as err:
        status = err.code
        text = err.read().decode("utf-8", errors="replace")
        raise ValueError(f"JMAP session fetch failed (HTTP {status}): {text}") from err

    if status < 200 or status >= 300:
        raise ValueError(f"JMAP session fetch failed (HTTP {status}): {text}")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as err:
        raise ValueError("JMAP session response is not valid JSON.") from err
    if not isinstance(parsed, dict):
        raise ValueError("JMAP session response is not valid JSON.")
    return parsed


def extract_primary_mail_account_id(session: Mapping[str, object]) -> str:
    primary = session.get("primaryAccounts")
    if not isinstance(primary, dict):
        raise ValueError("JMAP session missing primaryAccounts.")
    account_id = primary.get(JMAP_MAIL_URN)
    if not isinstance(account_id, str) or not account_id:
        raise ValueError(f"JMAP session missing primaryAccounts['{JMAP_MAIL_URN}'].")
    return account_id


def extract_blob_endpoints(session: Mapping[str, object]) -> tuple[str, str]:
    upload_url = session.get("uploadUrl")
    download_url = session.get("downloadUrl")
    if not isinstance(upload_url, str) or not upload_url:
        raise ValueError("JMAP session missing uploadUrl.")
    if not isinstance(download_url, str) or not download_url:
        raise ValueError("JMAP session missing downloadUrl.")
    return upload_url, download_url


def extract_jmap_api_url(session: Mapping[str, object]) -> str:
    api_url = session.get("apiUrl")
    if not isinstance(api_url, str) or not api_url:
        raise ValueError("JMAP session missing apiUrl.")
    return api_url


def _as_non_negative_int(value: object) -> int | None:
    if not isinstance(value, int):
        return None
    if value < 0:
        return None
    return value


def extract_blob_upload_limits(
    session: Mapping[str, object],
    account_id: str,
) -> dict[str, int | None] | None:
    accounts = session.get("accounts")
    if not isinstance(accounts, dict):
        return None
    account = accounts.get(account_id)
    if not isinstance(account, dict):
        return None
    account_capabilities = account.get("accountCapabilities")
    if not isinstance(account_capabilities, dict):
        return None
    blob_capabilities = account_capabilities.get(JMAP_BLOB_URN)
    if not isinstance(blob_capabilities, dict):
        return None

    raw_max_size = blob_capabilities.get("maxSizeBlobSet")
    max_size_blob_set: int | None = None
    if raw_max_size is None:
        max_size_blob_set = None
    else:
        parsed_max_size = _as_non_negative_int(raw_max_size)
        if parsed_max_size is not None:
            max_size_blob_set = parsed_max_size

    out: dict[str, int | None] = {"maxSizeBlobSet": max_size_blob_set}
    parsed_max_data_sources = _as_non_negative_int(blob_capabilities.get("maxDataSources"))
    if parsed_max_data_sources is not None:
        out["maxDataSources"] = parsed_max_data_sources
    return out


def _normalize_username(username: str) -> str:
    return username.strip().lower()
