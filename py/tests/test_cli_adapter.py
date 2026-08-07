from __future__ import annotations

import json

from atomicmail.cli import main
from atomicmail.jmap_request import JmapRequestResult


def test_cli_register_dispatches_and_prints_json(monkeypatch, capsys) -> None:
    def _fake_register(
        username: str | None,
        *,
        api_key: str | None,
        credentials_dir: str | None,
        forced: bool,
    ):
        assert username == "alice"
        assert api_key is None
        assert credentials_dir == "/tmp/creds"
        assert forced is True
        return type(
            "RegisterResult",
            (),
            {"__dict__": {"inbox": "alice@atomicmail.ai", "accountId": "acc-1", "apiKey": "k"}},
        )()

    monkeypatch.setattr("atomicmail.cli.register", _fake_register)

    code = main(
        [
            "register",
            "--username",
            "alice",
            "--credentials-dir",
            "/tmp/creds",
            "--forced",
            "--watch",
            "on-demand",
        ]
    )

    assert code == 0
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert parsed["inbox"] == "alice@atomicmail.ai"
    assert parsed["accountId"] == "acc-1"


def test_cli_register_with_api_key_dispatches(monkeypatch, capsys) -> None:
    def _fake_register(
        username: str | None,
        *,
        api_key: str | None,
        credentials_dir: str | None,
        forced: bool,
    ):
        assert username is None
        assert api_key == "existing-api-key"
        assert credentials_dir == "/tmp/creds"
        assert forced is False
        return type(
            "RegisterResult",
            (),
            {
                "__dict__": {
                    "inbox": "alice@atomicmail.ai",
                    "accountId": "acc-1",
                    "apiKey": None,
                }
            },
        )()

    monkeypatch.setattr("atomicmail.cli.register", _fake_register)

    code = main(
        [
            "register",
            "--api-key",
            "existing-api-key",
            "--credentials-dir",
            "/tmp/creds",
            "--watch",
            "on-demand",
        ]
    )

    assert code == 0
    out = capsys.readouterr().out
    parsed = json.loads(out)
    assert parsed["inbox"] == "alice@atomicmail.ai"
    assert parsed["accountId"] == "acc-1"


def test_cli_register_rejects_forced_with_api_key(capsys) -> None:
    code = main(["register", "--api-key", "existing-api-key", "--forced"])
    assert code == 2
    err = capsys.readouterr().err
    assert "--forced can only be used with --username." in err


def test_cli_register_requires_watch(capsys) -> None:
    code = main(["register", "--username", "alice"])
    assert code == 2
    err = capsys.readouterr().err
    # Opens with the requirement, defers meanings to help topic cron, and does not
    # explain the values (which is what lets an agent decide from the text).
    assert err.startswith("Error: register requires 'watch'")
    assert "help topic cron" in err
    assert "recurring job" not in err
    assert "once a day" not in err


def test_cli_register_rejects_invalid_watch(capsys) -> None:
    code = main(["register", "--username", "alice", "--watch", "weekly"])
    assert code == 2
    err = capsys.readouterr().err
    assert "register requires 'watch'" in err
    # `none` is no longer accepted — it was renamed to `on-demand`.
    code = main(["register", "--username", "alice", "--watch", "none"])
    assert code == 2
    assert "register requires 'watch'" in capsys.readouterr().err


def test_cli_register_help_does_not_enumerate_watch_values(capsys) -> None:
    # Values off --help let an agent fill the flag without reading the error's
    # "operator's decision" wording. They must appear only in the error.
    try:
        main(["register", "--help"])
    except SystemExit:
        pass
    out = capsys.readouterr().out
    assert "--watch" in out
    for value in ("scheduled", "on-demand"):
        assert value not in out


def test_cli_register_help_does_not_list_forced(capsys) -> None:
    # A ready-made replace flag in --help is what an agent reaches for; overwriting
    # an inbox is irreversible, so --forced is documented only in the refusal error.
    try:
        main(["register", "--help"])
    except SystemExit:
        pass
    out = capsys.readouterr().out
    assert "--forced" not in out


def test_cli_register_required_watch_error_names_both_values(capsys) -> None:
    code = main(["register", "--username", "alice"])
    assert code == 2
    err = capsys.readouterr().err
    assert "scheduled" in err
    assert "on-demand" in err


def test_cli_register_scheduled_appends_setup(monkeypatch, capsys) -> None:
    def _fake_register(username, *, api_key, credentials_dir, forced):
        return type(
            "RegisterResult",
            (),
            {"__dict__": {"inbox": "alice@atomicmail.ai", "accountId": "acc-1", "apiKey": "k"}},
        )()

    monkeypatch.setattr("atomicmail.cli.register", _fake_register)
    # The CLI prints the setup step and never runs it — the agent drives its own
    # scheduler. Real detection is covered in test_register_watch_schedule.py.
    monkeypatch.setattr(
        "atomicmail.cli.schedule_setup",
        lambda **kwargs: 'watch="scheduled" — set it up. Remove it later with: '
        "openclaw cron remove atomicmail-inbox",
    )

    code = main(["register", "--username", "alice", "--watch", "scheduled"])
    assert code == 0
    out = capsys.readouterr().out
    assert "alice@atomicmail.ai" in out
    assert 'watch="scheduled"' in out
    # the removal instruction is printed alongside.
    assert "Remove it later with" in out


def test_cli_jmap_request_parses_args_and_vars(monkeypatch, capsys) -> None:
    def _fake_jmap_request(**kwargs):
        assert kwargs["ops_file"] == "list_inbox.json"
        assert kwargs["credentials_dir"] == "/tmp/creds"
        assert kwargs["using"] == ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"]
        assert kwargs["vars"] == {"SUBJECT": "Hello"}
        assert kwargs["attachments"][0].path == "note.txt"
        return JmapRequestResult(ok=True, status=200, bodyText='{"ok":true}')

    monkeypatch.setattr("atomicmail.cli.jmap_request", _fake_jmap_request)

    code = main(
        [
            "jmap_request",
            "--ops-file",
            "list_inbox.json",
            "--credentials-dir",
            "/tmp/creds",
            "--vars",
            '{"SUBJECT":"Hello"}',
            "--attachment",
            "note.txt",
        ]
    )

    assert code == 0
    out = capsys.readouterr().out
    assert '{"ok":true}' in out


def test_cli_jmap_request_rejects_dry_run_with_attachment(capsys) -> None:
    code = main(
        [
            "jmap_request",
            "--ops",
            '[]',
            "--dry-run",
            "--attachment",
            "note.txt",
        ]
    )
    assert code == 2
    err = capsys.readouterr().err
    assert "--dry-run cannot be combined with --attachment." in err
