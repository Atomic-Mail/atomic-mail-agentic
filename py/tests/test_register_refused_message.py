from __future__ import annotations

from atomicmail.shared_assets import read_shared_json

# The refused-credentials wording the register surfaces should show. NOTE: the
# live copy is still hardcoded inside session.register() (out of bounds to edit);
# this guards the shared source of truth, which is where it belongs.


def test_shared_refused_message_opens_with_risk_not_flag() -> None:
    errors = read_shared_json("messages/errors.json")
    msg = errors["agent_register_refused_existing_credentials_template"].rstrip()

    # Opens with the irreversible loss, before any explanation of the refusal.
    assert msg.startswith("Register refused: replacing")
    assert "irreversibly destroys" in msg
    # The safe path is offered.
    assert "--credentials-dir in AgentSkill" in msg
    # The replace flag stays discoverable but is not the closing, paste-ready line.
    assert "--forced in AgentSkill" in msg
    assert not msg.endswith("--forced")
    assert msg.endswith("your operator's decision, not yours.")
