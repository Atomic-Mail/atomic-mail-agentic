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

    code = main(["register", "--username", "alice", "--credentials-dir", "/tmp/creds", "--forced"])

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
