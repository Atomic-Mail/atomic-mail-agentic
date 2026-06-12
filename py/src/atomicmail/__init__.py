"""Atomic Mail Python shared foundation package."""

from .config import ResolvedAgentConfig, resolve_agent_config_from_env
from .credentials import Credentials, SkillFiles, default_files_from_out_dir
from .help import help
from .jmap_request import JmapRequestResult, jmap_request, run_jmap_request
from .session import AgentSession, RegisterResult, register

__all__ = [
    "AgentSession",
    "Credentials",
    "JmapRequestResult",
    "RegisterResult",
    "ResolvedAgentConfig",
    "SkillFiles",
    "default_files_from_out_dir",
    "help",
    "jmap_request",
    "run_jmap_request",
    "register",
    "resolve_agent_config_from_env",
]
