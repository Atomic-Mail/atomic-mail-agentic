"""Built-in help topics loaded from shared assets."""

from __future__ import annotations

from typing import Mapping

from .shared_assets import try_read_shared_json, try_read_shared_text

_DEFAULT_UNKNOWN_TOPIC = 'Unknown topic "{topic}". Available topics: {topics}, readme'
_DEFAULT_README_STUB = (
    'Topic "readme" returns a built-in stub. '
    "No runtime package README lookup is performed. "
    'From MCP use {"topic":"readme"}; from the CLI: `atomicmail help --topic readme`.'
)
_FALLBACK_TOPICS: dict[str, str] = {
    "overview": "Atomic Mail help topics are unavailable in this build.",
    "installation": "See the package README for installation instructions.",
    "auth": "See register/auth docs in the package README.",
    "jmap_cheatsheet": "Use jmap_request with JMAP methodCalls envelope JSON.",
    "tools": "Available tools include register, help, and jmap_request.",
    "presets": "Use ops_file to load preset JSON operations.",
    "cron": "Arrange hourly inbox polling after register (help topic cron).",
    "multi_account": "Use separate credentials_dir values per account.",
    "troubleshooting": "Run help('troubleshooting') for common fixes.",
}


def normalize_help_topic(topic: str) -> str:
    return topic.lower().replace(" ", "_").replace("-", "_")


def _load_manifest_help() -> Mapping[str, object] | None:
    manifest = try_read_shared_json("manifest.json")
    if not isinstance(manifest, dict):
        return None
    help_config = manifest.get("help")
    if not isinstance(help_config, dict):
        return None
    return help_config


def _load_error_unknown_topic_template() -> str:
    messages = try_read_shared_json("messages/errors.json")
    if not isinstance(messages, dict):
        return _DEFAULT_UNKNOWN_TOPIC
    template = messages.get("help_unknown_topic_template")
    if not isinstance(template, str) or not template:
        return _DEFAULT_UNKNOWN_TOPIC
    return template


def _load_readme_stub(help_config: Mapping[str, object] | None) -> str:
    if help_config is not None:
        readme_stub_path = help_config.get("readme_stub_path")
        if isinstance(readme_stub_path, str):
            text = try_read_shared_text(readme_stub_path)
            if text:
                return text.strip()
    errors = try_read_shared_json("messages/errors.json")
    if isinstance(errors, dict):
        fallback = errors.get("help_readme_stub")
        if isinstance(fallback, str) and fallback:
            return fallback
    return _DEFAULT_README_STUB


def _load_topics() -> tuple[dict[str, str], list[str]]:
    help_config = _load_manifest_help()
    if help_config is None:
        topic_order = list(_FALLBACK_TOPICS.keys())
        return dict(_FALLBACK_TOPICS), topic_order

    topic_order = help_config.get("topic_order")
    topics_dir = help_config.get("topics_dir")
    if not isinstance(topic_order, list) or not isinstance(topics_dir, str):
        fallback_order = list(_FALLBACK_TOPICS.keys())
        return dict(_FALLBACK_TOPICS), fallback_order

    topics: dict[str, str] = {}
    normalized_order: list[str] = []
    for topic in topic_order:
        if not isinstance(topic, str):
            continue
        topic_text = try_read_shared_text(f"{topics_dir}/{topic}.md")
        if topic_text is None:
            topic_text = _FALLBACK_TOPICS.get(topic, "")
        topics[topic] = topic_text
        normalized_order.append(topic)

    if not normalized_order:
        normalized_order = list(_FALLBACK_TOPICS.keys())
        return dict(_FALLBACK_TOPICS), normalized_order
    return topics, normalized_order


_HELP_TOPICS, HELP_TOPIC_LIST = _load_topics()
_HELP_UNKNOWN_TOPIC_TEMPLATE = _load_error_unknown_topic_template()
_HELP_README_STUB = _load_readme_stub(_load_manifest_help())


def get_help(topic: str | None = None) -> str:
    if not topic:
        return _HELP_TOPICS.get("overview", _FALLBACK_TOPICS["overview"])

    normalized = normalize_help_topic(topic)
    if normalized == "readme":
        return _HELP_README_STUB

    found = _HELP_TOPICS.get(normalized)
    if found is not None:
        return found
    return _HELP_UNKNOWN_TOPIC_TEMPLATE.replace("{topic}", topic).replace(
        "{topics}", ", ".join(HELP_TOPIC_LIST)
    )


def help(topic: str | None = None) -> str:
    """Return built-in help text for a topic or overview."""
    return get_help(topic)
