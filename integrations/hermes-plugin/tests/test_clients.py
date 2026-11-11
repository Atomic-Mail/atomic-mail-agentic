"""Settings, proof-of-work sign-up and the JMAP client."""

from __future__ import annotations

import json

import httpx
import pytest

from conftest import AGENT, API_KEY, jwt

from atomicmail_plugin import auth, config
from atomicmail_plugin.jmap import JmapError, summarize


def test_settings_defaults_and_lists(settings_env):
    settings_env.update({"ATOMICMAIL_API_KEY": API_KEY, "ATOMICMAIL_ALLOWED_USERS": " Me@Example.com, you@x.io "})
    s = config.read_settings()
    assert s.configured and s.allowed_users == frozenset({"me@example.com", "you@x.io"})
    assert s.auth_url == config.DEFAULT_AUTH_URL and s.poll_interval == 20 and not s.trust_from_header
    assert s.home_address == ""  # two senders: no implicit home
    assert API_KEY not in json.dumps(s.public_view())


def test_settings_json_list_single_home_and_floor(settings_env):
    settings_env.update({"ATOMICMAIL_ALLOWED_USERS": '["Boss@Corp.com"]', "ATOMICMAIL_POLL_INTERVAL": "2"})
    s = config.read_settings()
    assert s.allowed_users == frozenset({"boss@corp.com"}) and s.home_address == "boss@corp.com"
    assert s.poll_interval == config.MIN_POLL_INTERVAL and not s.configured


def test_settings_yaml_extra_used_when_env_empty(settings_env):
    s = config.read_settings({"api_key": API_KEY, "allowed_users": ["a@b.co"], "trust_from_header": True})
    assert s.api_key == API_KEY and s.allowed_users == {"a@b.co"} and s.trust_from_header


def test_pow_solution_matches_difficulty():
    import hashlib
    pow_hex, nonce = auth.solve_pow("challenge-1", 4)
    digest = hashlib.scrypt(f"challenge-1:{nonce}".encode(), salt=auth.POW_SCRYPT_SALT.encode(), n=16384, r=8, p=1,
                            dklen=64)
    assert digest.hex() == pow_hex and digest[0] >> 4 == 0


def _auth_server(seen: dict, *, capability_status: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.endswith("/challenge"):
            return httpx.Response(200, headers={"Authorization": "Bearer " + jwt({"jti": "c1", "difficulty": 2})})
        if path.endswith("/session"):
            seen["session"] = json.loads(request.content)
            return httpx.Response(200, json={"apiKey": API_KEY},
                                  headers={"Authorization": "Bearer " + jwt({"exp": 9e9})})
        if path.endswith("/capability"):
            if capability_status != 200:
                return httpx.Response(capability_status, text="down")
            return httpx.Response(200, headers={"Authorization": "Bearer " + jwt({"inboxId": "my-agent", "exp": 9e9})})
        return httpx.Response(404)
    return httpx.MockTransport(handler)


def test_register_flow_and_username_rules():
    seen = {}
    client = auth.AuthClient("https://auth.test", transport=_auth_server(seen))
    result = client.register("My-Agent")
    assert result.api_key == API_KEY and result.address == "my-agent@atomicmail.ai"
    assert seen["session"]["username"] == "my-agent" and "apiKey" not in seen["session"]
    for bad in ("abc", "-bad-name", "a" * 22, "has space"):
        with pytest.raises(auth.AuthError):
            auth.normalize_username(bad)
    assert auth.normalize_username("ok.name_1@atomicmail.ai") == "ok.name_1"


def test_register_keeps_the_key_when_the_follow_up_fails():
    client = auth.AuthClient("https://auth.test", transport=_auth_server({}, capability_status=503))
    result = client.register("my-agent")
    assert result.api_key == API_KEY and result.address == "my-agent@atomicmail.ai"


def test_session_manager_reuses_tokens():
    counts = {"session": 0, "capability": 0}

    def handler(request):
        path = request.url.path
        if path.endswith("/challenge"):
            return httpx.Response(200, headers={"Authorization": "Bearer " + jwt({"jti": "c", "difficulty": 1})})
        if path.endswith("/session"):
            counts["session"] += 1
            assert json.loads(request.content)["apiKey"] == API_KEY
            return httpx.Response(200, headers={"Authorization": "Bearer " + jwt({"exp": 9e9})})
        counts["capability"] += 1
        return httpx.Response(200, headers={"Authorization": "Bearer " + jwt({"exp": 9e9, "n": counts["capability"]})})

    manager = auth.SessionManager(API_KEY, "https://auth.test",
                                  client=auth.AuthClient("https://auth.test", transport=httpx.MockTransport(handler)))
    first = manager.capability()
    assert manager.capability() == first and counts == {"session": 1, "capability": 1}
    manager.capability(force=True)
    assert counts == {"session": 1, "capability": 2}


def test_jmap_address_inbox_and_summaries(jmap_client, fake_jmap):
    assert jmap_client.address == AGENT
    fake_jmap.add("m1", "a@b.co", "Hi", received="2099-01-01T00:00:00Z")
    fake_jmap.add("m2", "c@d.co", "Later", received="2099-01-02T00:00:00Z")
    fake_jmap.add("s1", AGENT, "Sent one", mailbox="mb-sent")
    rows = jmap_client.recent_messages(10)
    assert [r["id"] for r in rows] == ["m2", "m1"]
    assert summarize(rows[0]) == {"id": "m2", "from": "c@d.co", "from_name": None, "subject": "Later",
                                  "preview": "hello", "received_at": "2099-01-02T00:00:00Z"}
    assert [r["id"] for r in jmap_client.search("later")] == ["m2"]


def test_jmap_raw_message_and_body(jmap_client, fake_jmap):
    fake_jmap.add("m1", "a@b.co", "Hi", raw=b"From: a@b.co\r\n\r\nraw body", body="plain text")
    assert jmap_client.raw_message("m1").endswith(b"raw body")
    message = jmap_client.get_message("m1")
    assert jmap_client.body_text(message) == "plain text"
    with pytest.raises(JmapError):
        jmap_client.get_message("missing")


def test_jmap_send_builds_draft_and_envelope(jmap_client, fake_jmap):
    result = jmap_client.send("Bob <bob@x.io>, carol@y.io", "Hello\r\nBcc: evil@z", "Body", bcc="dave@z.io")
    assert result["status"] == "sent" and result["to"] == ["bob@x.io", "carol@y.io"]
    draft = fake_jmap.sent[-1]
    assert draft["from"] == [{"email": AGENT}] and draft["subject"] == "Hello  Bcc: evil@z"
    assert draft["to"] == [{"email": "bob@x.io", "name": "Bob"}, {"email": "carol@y.io"}]
    submission = dict(fake_jmap.calls)["EmailSubmission/set"]["create"]["s1"]["envelope"]
    assert submission["rcptTo"] == [{"email": "bob@x.io"}, {"email": "carol@y.io"}, {"email": "dave@z.io"}]


def test_jmap_reply_threads_to_sender(jmap_client, fake_jmap):
    fake_jmap.add("m1", "owner@example.com", "Plan my week", name="Owner", message_id="orig@example.com")
    result = jmap_client.reply("m1", "Done.")
    draft = fake_jmap.sent[-1]
    assert result["in_reply_to"] == "m1" and draft["subject"] == "Re: Plan my week"
    assert draft["to"] == [{"email": "owner@example.com", "name": "Owner"}]
    assert draft["inReplyTo"] == ["orig@example.com"] and draft["references"] == ["orig@example.com"]


def test_jmap_errors(jmap_client, fake_jmap):
    fake_jmap.set_errors["d1"] = {"type": "overQuota", "description": "daily recipient limit"}
    with pytest.raises(JmapError, match="daily recipient limit"):
        jmap_client.send("a@b.co", "s", "b")
    fake_jmap.status = 503
    with pytest.raises(JmapError) as exc:
        jmap_client.recent_messages()
    assert exc.value.retryable


EXPIRED = '{"error":{"message":"Invalid challenge JWT: \\"exp\\" claim timestamp check failed"}}'


def _expiring_server(outcomes: list, seen: dict):
    """Auth server whose /session answers are the HTTP statuses in ``outcomes``, one per try."""
    def handler(request):
        path = request.url.path
        if path.endswith("/challenge"):
            seen["challenges"] = seen.get("challenges", 0) + 1
            return httpx.Response(200, headers={"Authorization": "Bearer " + jwt(
                {"jti": f"c{seen['challenges']}", "difficulty": 0, "exp": 9e9})})
        if path.endswith("/session"):
            status = outcomes.pop(0)
            if status != 200:
                return httpx.Response(status, text=EXPIRED)
            return httpx.Response(200, headers={"Authorization": "Bearer " + jwt({"exp": 9e9})})
        return httpx.Response(404)
    return httpx.MockTransport(handler)


def test_session_replaces_an_expired_challenge():
    seen = {}
    client = auth.AuthClient("https://auth.test", transport=_expiring_server([400, 200], seen))
    assert client.session(api_key=API_KEY)[0] and seen["challenges"] == 2


def test_session_that_keeps_expiring_is_retryable_not_fatal():
    seen = {}
    client = auth.AuthClient("https://auth.test", transport=_expiring_server([400] * auth.CHALLENGE_ATTEMPTS, seen))
    with pytest.raises(auth.AuthError) as info:
        client.session(api_key=API_KEY)
    assert info.value.retryable and seen["challenges"] == auth.CHALLENGE_ATTEMPTS


def test_session_with_a_dead_key_fails_at_once():
    seen = {}
    client = auth.AuthClient("https://auth.test", transport=_expiring_server([401], seen))
    with pytest.raises(auth.AuthError) as info:
        client.session(api_key=API_KEY)
    assert not info.value.retryable and info.value.status == 401 and seen["challenges"] == 1


def test_session_drops_a_challenge_that_ran_out_mid_solve(monkeypatch):
    import time
    issued = []

    def handler(request):
        if request.url.path.endswith("/challenge"):
            exp = time.time() - 60 if not issued else 9e9  # the first one is already stale
            issued.append(jwt({"jti": f"c{len(issued)}", "difficulty": 0, "exp": exp}))
            return httpx.Response(200, headers={"Authorization": "Bearer " + issued[-1]})
        assert request.headers["authorization"] == "Bearer " + issued[-1]
        return httpx.Response(200, headers={"Authorization": "Bearer " + jwt({"exp": 9e9})})

    def fake_solve(challenge, difficulty, *, on_progress=None, should_stop=None):
        if should_stop and should_stop():
            raise auth.PowCancelled("stopped")
        return "00", "0"

    monkeypatch.setattr(auth, "solve_pow", fake_solve)
    client = auth.AuthClient("https://auth.test", transport=httpx.MockTransport(handler))
    assert client.session(api_key=API_KEY)[0] and len(issued) == 2
