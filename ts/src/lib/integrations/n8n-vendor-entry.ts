/**
 * Entry point for esbuild n8n vendor bundle (@atomicmail/agentic-core inlined).
 * Must not import node:fs / node:path / restricted globals into the output.
 */

export { createAgentSession } from "./create-agent-session.ts";
export type { IntegrationEnv } from "./create-agent-session.ts";
export {
  createN8nCredentialStore,
  createKeyValueStore,
  n8nStaticDataBackend,
} from "./n8n-credential-store.ts";
export type { AgentSession } from "../agent/session/agent-session.ts";
export {
  runJmapRequest,
  DEFAULT_JMAP_USING,
} from "../agent/jmap/agent-jmap-run.ts";
export {
  readOpsFile,
  BUNDLED_OPS_PRESET_NAMES,
} from "./n8n-cloud/read-ops-file.ts";
export { getHelp, HELP_TOPIC_LIST } from "./n8n-cloud/help.ts";
export { sharedError } from "../core/messages.ts";
export { postRegisterCronReminder } from "../agent/jmap/help-content/cron.ts";
export {
  guessMimeTypeFromFilename,
  expandUploadUrl,
  postBinaryBlobUpload,
} from "../agent/jmap/agent-jmap-blob-http.ts";
export { assertAttachmentBytesWithinBlobLimit } from "../agent/jmap/agent-jmap-blob-limits.ts";
