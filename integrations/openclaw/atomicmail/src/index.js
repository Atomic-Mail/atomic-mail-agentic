import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

const MCP_RUNTIME_PACKAGE = "@atomicmail/mcp-clawhub";

/**
 * Minimal OpenClaw plugin entry.
 *
 * This intentionally does not attempt automatic MCP registration because the
 * exact stable plugin-side hook for mutating OpenClaw's MCP config was not
 * verified during this task. The ClawHub package exists to give Atomic Mail a
 * package/plugin presence while keeping the actual runtime in the MCP package.
 */
const plugin = definePluginEntry({
  id: "atomicmail",
  name: "Atomic Mail",
  description:
    "Thin wrapper package for the Atomic Mail MCP runtime on ClawHub/OpenClaw.",
  register() {
    // Keep setup explicit until OpenClaw documents a stable plugin-managed MCP
    // registration hook and a safe cron creation surface for package install.
  },
});

export const atomicmailMcpRuntime = {
  command: "npx",
  args: ["-y", MCP_RUNTIME_PACKAGE],
};

export default plugin;
