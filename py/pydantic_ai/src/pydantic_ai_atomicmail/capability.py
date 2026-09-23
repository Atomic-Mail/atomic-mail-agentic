"""Pydantic AI capability wrapping the Atomic Mail toolset."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.toolsets import AgentToolset

from .toolset import AtomicMailToolset

__all__ = ["AtomicMailCapability"]

_INSTRUCTIONS = """\
You have your own Atomic Mail inbox, reachable through the `register`, \
`jmap_request` and `help` tools.

Call `help` before your first `jmap_request` — it documents the available \
presets and JMAP method calls. If no inbox exists yet, call `register` first; \
it is idempotent for the same username. Never invent JMAP method calls you have \
not seen in help; read the relevant topic instead.\
"""


@dataclass(init=False)
class AtomicMailCapability(AbstractCapability[Any]):
    """Give an agent a real email inbox.

    Bundles the Atomic Mail tools with instructions telling the model how to use
    them.

    ```python {test="skip"}
    from pydantic_ai import Agent
    from pydantic_ai_atomicmail import AtomicMailCapability

    agent = Agent('openai:gpt-5.2', capabilities=[AtomicMailCapability()])
    ```

    Args:
        credentials_dir: Directory credentials are read from and written to.
        instructions: Replace the default instructions; pass `None` to add none.
    """

    credentials_dir: str | None
    instructions: str | None

    def __init__(
        self,
        *,
        credentials_dir: str | None = None,
        instructions: str | None = _INSTRUCTIONS,
    ) -> None:
        self.credentials_dir = credentials_dir
        self.instructions = instructions

    def get_toolset(self) -> AgentToolset[Any] | None:
        return AtomicMailToolset(credentials_dir=self.credentials_dir)

    def get_instructions(self) -> Any:
        return self.instructions
