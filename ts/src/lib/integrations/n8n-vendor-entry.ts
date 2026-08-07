/**
 * Entry point for esbuild n8n vendor bundle (@atomicmail/agentic-core inlined).
 * Must not import node:fs / node:path / restricted globals into the output.
 */

export { createAgentSession } from "./create-agent-session.ts";
export type { IntegrationEnv } from "./create-agent-session.ts";
export {
  createKeyValueStore,
  createN8nCredentialStore,
  n8nStaticDataBackend,
} from "./n8n-credential-store.ts";
export type { AgentSession } from "../agent/session/agent-session.ts";
export {
  DEFAULT_JMAP_USING,
  runJmapRequest,
} from "../agent/jmap/agent-jmap-run.ts";
export {
  BUNDLED_OPS_PRESET_NAMES,
  readOpsFile,
} from "./n8n-cloud/read-ops-file.ts";
export { getHelp, HELP_TOPIC_LIST } from "./n8n-cloud/help.ts";
export { sharedError } from "../core/messages.ts";
export { postRegisterCronReminder } from "../agent/jmap/help-content/cron.ts";
export {
  expandUploadUrl,
  guessMimeTypeFromFilename,
  postBinaryBlobUpload,
} from "../agent/jmap/agent-jmap-blob-http.ts";
export { assertAttachmentBytesWithinBlobLimit } from "../agent/jmap/agent-jmap-blob-limits.ts";
