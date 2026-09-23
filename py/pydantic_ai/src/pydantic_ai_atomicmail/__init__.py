"""Pydantic AI integration package for Atomic Mail."""

from .capability import AtomicMailCapability
from .toolset import AtomicMailToolset
from .tools import help_tool, jmap_request_tool, register_tool

__all__ = [
    "AtomicMailCapability",
    "AtomicMailToolset",
    "help_tool",
    "jmap_request_tool",
    "register_tool",
]
