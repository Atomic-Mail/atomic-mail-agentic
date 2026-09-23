"""Pydantic AI toolset exposing the Atomic Mail tools."""

from __future__ import annotations

from typing import Any

from pydantic_ai.toolsets import FunctionToolset

from .tools import HELP_TOPIC_LIST, help_tool, jmap_request_tool, register_tool

__all__ = ["AtomicMailToolset"]

_HELP_DESCRIPTION = (
    "Built-in Atomic Mail docs. Call early and often. Topics: "
    f"{', '.join(HELP_TOPIC_LIST)}, readme."
)


class AtomicMailToolset(FunctionToolset[Any]):
    """Give an agent its own email inbox.

    Registers three tools backed by the same Atomic Mail runtime used by the CLI
    and MCP adapters:

    - `register` — proof-of-work signup that provisions an inbox and stores credentials
    - `jmap_request` — authenticated JMAP method-call batches (read, send, search, ...)
    - `help` — the built-in Atomic Mail docs

    ```python {test="skip"}
    from pydantic_ai import Agent
    from pydantic_ai_atomicmail import AtomicMailToolset

    agent = Agent('openai:gpt-5.2', toolsets=[AtomicMailToolset()])
    ```

    Args:
        credentials_dir: Directory credentials are read from and written to. When
            set, it is used as the default for every tool call; the model can
            still override it per call.
        **kwargs: Forwarded to [`FunctionToolset`][pydantic_ai.toolsets.FunctionToolset].
    """

    def __init__(self, *, credentials_dir: str | None = None, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.credentials_dir = credentials_dir

        self.add_function(
            self._register,
            name="register",
            description=register_tool.__doc__,
        )
        self.add_function(
            self._jmap_request,
            name="jmap_request",
            description=jmap_request_tool.__doc__,
        )
        self.add_function(
            help_tool,
            name="help",
            description=_HELP_DESCRIPTION,
        )

    def _resolve_credentials_dir(self, credentials_dir: str | None) -> str | None:
        return credentials_dir if credentials_dir is not None else self.credentials_dir

    def _register(self, username: str, credentials_dir: str | None = None, forced: bool = False) -> str:
        return register_tool(
            username=username,
            credentials_dir=self._resolve_credentials_dir(credentials_dir),
            forced=forced,
        )

    def _jmap_request(
        self,
        ops: str | None = None,
        ops_file: str | None = None,
        vars: dict[str, str] | None = None,
        dry_run: bool = False,
        attachments: list[dict[str, Any]] | None = None,
        using: list[str] | None = None,
        credentials_dir: str | None = None,
    ) -> str:
        return jmap_request_tool(
            ops=ops,
            ops_file=ops_file,
            vars=vars,
            dry_run=dry_run,
            attachments=attachments,
            using=using,
            credentials_dir=self._resolve_credentials_dir(credentials_dir),
        )
