"""Atomic Mail Python shared foundation package."""

from .config import ResolvedAgentConfig, resolve_agent_config_from_env
from .credentials import Credentials, SkillFiles, default_files_from_out_dir
from .session import AgentSession, RegisterResult, register

__all__ = [
    "AgentSession",
    "Credentials",
    "RegisterResult",
    "ResolvedAgentConfig",
    "SkillFiles",
    "default_files_from_out_dir",
    "register",
    "resolve_agent_config_from_env",
]
