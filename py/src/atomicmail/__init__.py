"""Atomic Mail Python shared foundation package."""

from .config import ResolvedAgentConfig, resolve_agent_config_from_env
from .credentials import (
    CredentialStore,
    Credentials,
    SkillFiles,
    default_files_from_out_dir,
)
from .help import help
from .jmap_request import JmapAttachmentInput, JmapRequestResult, jmap_request, run_jmap_request
from .mcp_server import handle_tool_call
from .session import AgentSession, RegisterResult, create_agent_session, register

__all__ = [
    "AgentSession",
    "Credentials",
    "CredentialStore",
    "JmapRequestResult",
    "JmapAttachmentInput",
    "RegisterResult",
    "ResolvedAgentConfig",
    "SkillFiles",
    "default_files_from_out_dir",
    "help",
    "handle_tool_call",
    "jmap_request",
    "run_jmap_request",
    "register",
    "create_agent_session",
    "resolve_agent_config_from_env",
]
