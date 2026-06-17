from __future__ import annotations

from atomicmail.help import HELP_TOPIC_LIST, get_help, help, normalize_help_topic


def test_help_defaults_to_overview_topic() -> None:
    text = help()
    assert isinstance(text, str)
    assert len(text.strip()) > 0


def test_help_readme_topic_uses_shared_stub() -> None:
    text = get_help("readme")
    assert "built-in stub" in text
    assert "AgentSkill runtimes" in text
    assert "returns package `README.md`" in text


def test_help_unknown_topic_uses_shared_template() -> None:
    text = get_help("not-a-topic")
    assert 'Unknown topic "not-a-topic"' in text
    assert ", ".join(HELP_TOPIC_LIST) in text


def test_normalize_help_topic() -> None:
    assert normalize_help_topic("Jmap-Cheatsheet") == "jmap_cheatsheet"
