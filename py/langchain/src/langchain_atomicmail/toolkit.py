"""Toolkit helpers for Atomic Mail LangChain tools."""

from __future__ import annotations

from dataclasses import dataclass

from langchain_core.tools import BaseTool

from .tools import get_atomicmail_tools


@dataclass
class AtomicMailToolkit:
    """Factory-style toolkit exposing Atomic Mail tools."""

    def get_tools(self) -> list[BaseTool]:
        return get_atomicmail_tools()
