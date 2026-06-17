"""Toolkit helpers for Atomic Mail LangChain tools."""

from __future__ import annotations

from langchain_core.tools import BaseTool
from langchain_core.tools.base import BaseToolkit

from .tools import get_atomicmail_tools


class AtomicMailToolkit(BaseToolkit):
    """Factory-style toolkit exposing Atomic Mail tools."""

    def get_tools(self) -> list[BaseTool]:
        return get_atomicmail_tools()
