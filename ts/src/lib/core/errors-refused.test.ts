import { assert, assertStringIncludes } from "@std/assert";

import { tryReadSharedJson } from "./shared-assets.ts";

// The refused-credentials wording the register surfaces should show. NOTE: the
// live copy is still hardcoded inside session.register() (out of bounds to edit);
// this guards the shared source of truth, which is where it belongs.
Deno.test("shared refused-credentials message opens with the irreversible risk, not the flag", () => {
  const errors = tryReadSharedJson<Record<string, string>>(
    "messages/errors.json",
  )!;
  const msg = errors.agent_register_refused_existing_credentials_template
    .trimEnd();

  // Opens with the irreversible loss, before any explanation of the refusal.
  assert(msg.startsWith("Register refused: replacing"));
  assertStringIncludes(msg, "irreversibly destroys");
  // The safe path is offered.
  assertStringIncludes(msg, "--credentials-dir in AgentSkill");
  // The replace flag stays discoverable but is not the closing, paste-ready line.
  assertStringIncludes(msg, "--forced in AgentSkill");
  assert(!msg.endsWith("--forced"));
  assert(msg.endsWith("your operator's decision, not yours."));
});
