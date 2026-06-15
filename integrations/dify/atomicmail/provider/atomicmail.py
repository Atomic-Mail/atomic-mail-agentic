from typing import Any

from dify_plugin import ToolProvider
from dify_plugin.errors.tool import ToolProviderCredentialValidationError

from atomicmail.session import create_agent_session

from utils.dify_kv_store import DifyKvCredentialStore


class AtomicmailProvider(ToolProvider):
    def _validate_credentials(self, credentials: dict[str, Any]) -> None:
        try:
            api_key = credentials.get("api_key")
            if not isinstance(api_key, str) or not api_key.strip():
                # API key is optional: user can still register from tools.
                return

            env: dict[str, str] = {}
            auth_url = credentials.get("auth_url")
            api_url = credentials.get("api_url")
            if isinstance(auth_url, str) and auth_url.strip():
                env["ATOMIC_MAIL_AUTH_URL"] = auth_url.strip()
            if isinstance(api_url, str) and api_url.strip():
                env["ATOMIC_MAIL_API_URL"] = api_url.strip()

            store = DifyKvCredentialStore(
                storage=self.session.storage,
                account_id="default",
            )
            store.clear()

            session = create_agent_session(
                store=store,
                env=env or None,
                provider_api_key=api_key.strip(),
            )
            session.login_with_api_key(api_key.strip())
        except Exception as e:
            raise ToolProviderCredentialValidationError(str(e))

    #########################################################################################
    # If OAuth is supported, uncomment the following functions.
    # Warning: please make sure that the sdk version is 0.4.2 or higher.
    #########################################################################################
    # def _oauth_get_authorization_url(self, redirect_uri: str, system_credentials: Mapping[str, Any]) -> str:
    #     """
    #     Generate the authorization URL for atomicmail OAuth.
    #     """
    #     try:
    #         """
    #         IMPLEMENT YOUR AUTHORIZATION URL GENERATION HERE
    #         """
    #     except Exception as e:
    #         raise ToolProviderOAuthError(str(e))
    #     return ""
        
    # def _oauth_get_credentials(
    #     self, redirect_uri: str, system_credentials: Mapping[str, Any], request: Request
    # ) -> Mapping[str, Any]:
    #     """
    #     Exchange code for access_token.
    #     """
    #     try:
    #         """
    #         IMPLEMENT YOUR CREDENTIALS EXCHANGE HERE
    #         """
    #     except Exception as e:
    #         raise ToolProviderOAuthError(str(e))
    #     return dict()

    # def _oauth_refresh_credentials(
    #     self, redirect_uri: str, system_credentials: Mapping[str, Any], credentials: Mapping[str, Any]
    # ) -> OAuthCredentials:
    #     """
    #     Refresh the credentials
    #     """
    #     return OAuthCredentials(credentials=credentials, expires_at=-1)
