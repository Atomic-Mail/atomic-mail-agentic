import { assertEquals, assertStringIncludes } from "@std/assert";

import { readSharedJson, readSharedText } from "../../core/shared-assets.ts";
import {
  BUNDLED_OPS_PRESET_NAMES,
  readOpsFile,
} from "./agent-jmap.ts";
import { getHelp, HELP_TOPIC_LIST } from "./help-content/index.ts";

Deno.test("help topics load from shared manifest order", () => {
  const manifest = readSharedJson<{
    help: { topic_order: string[] };
  }>("manifest.json");
  assertEquals(HELP_TOPIC_LIST, manifest.help.topic_order);
});

Deno.test("getHelp readme uses shared stub for skill runtime", async () => {
  assertEquals(
    await getHelp("readme", "skill"),
    readSharedText("help/readme_stub.md").trim(),
  );
});

Deno.test("readOpsFile resolves bundled preset from shared assets", async () => {
  const credsDir = await Deno.makeTempDir({ prefix: "atomicmail-shared-jmap-" });
  try {
    const raw = await readOpsFile(credsDir, BUNDLED_OPS_PRESET_NAMES[0]);
    assertStringIncludes(raw, "\"methodCalls\"");
  } finally {
    await Deno.remove(credsDir, { recursive: true });
  }
});
