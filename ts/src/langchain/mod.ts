// Atomic Mail LangChain toolkit and tool factories.

import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

import {
  AgentSession,
  createAgentSessionForCredentialDir,
  DEFAULT_JMAP_USING,
  getHelp,
  HELP_TOPIC_LIST,
  readOpsFile,
  resolveAgentConfigFromEnv,
  type ResolvedAgentConfig,
  runJmapRequest,
  sharedError,
  USER_VAR_KEY_RE,
} from "../lib/mod.ts";
import { postRegisterCronReminder } from "../lib/agent/jmap/help-content/cron.ts";

export interface AtomicMailToolkitContext {
  defaultConfig: ResolvedAgentConfig;
  defaultSession: AgentSession;
}

export interface AtomicMailToolkitOptions {
  context?: AtomicMailToolkitContext;
}

type AtomicMailSessionMode = "register" | "jmap";

async function createDefaultContext(): Promise<AtomicMailToolkitContext> {
  const defaultConfig = await resolveAgentConfigFromEnv();
  const defaultSession = await AgentSession.create({
    authUrl: defaultConfig.authUrl,
    apiUrl: defaultConfig.apiUrl,
    scryptSalt: defaultConfig.scryptSalt,
    apiKey: defaultConfig.apiKey,
    inboxId: defaultConfig.inboxId,
    credentialDir: defaultConfig.credentialDir,
    files: defaultConfig.files,
  });
  return { defaultConfig, defaultSession };
}

async function resolveToolkitSession(
  ctx: AtomicMailToolkitContext,
  credentialsDir: string | undefined,
  mode: AtomicMailSessionMode,
): Promise<AgentSession> {
  if (!credentialsDir) {
    return ctx.defaultSession;
  }
  return await createAgentSessionForCredentialDir(
    credentialsDir,
    {
      authUrl: ctx.defaultConfig.authUrl,
      apiUrl: ctx.defaultConfig.apiUrl,
      scryptSalt: ctx.defaultConfig.scryptSalt,
    },
    { requireCredentials: mode === "jmap" },
  );
}

function buildRegisterTool(
  ctx: AtomicMailToolkitContext,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "register",
    description: "PoW signup; writes credentials. Usernames are 5-21 chars. " +
      "Idempotent for same username and stored inbox; different username is " +
      "rejected unless forced=true is provided. After success, arrange hourly " +
      "inbox polling per runtime (help topic cron).",
    schema: z.object({
      username: z.string().min(5).max(21),
      credentials_dir: z.string().optional(),
      forced: z.boolean().optional(),
    }),
    func: async ({ username, credentials_dir, forced }) => {
      const session = await resolveToolkitSession(
        ctx,
        credentials_dir,
        "register",
      );
      const result = await session.register(username, { forced });
      return JSON.stringify(
        {
          ...result,
          _next: [postRegisterCronReminder],
        },
        null,
        2,
      );
    },
  });
}

function buildJmapRequestTool(
  ctx: AtomicMailToolkitContext,
): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "jmap_request",
    description:
      "JMAP method-call batch with automatic auth. Exactly one of: " +
      "ops (JSON string) or ops_file (preset path). Supports vars " +
      "placeholder substitution and optional local-file attachments.",
    schema: z.object({
      credentials_dir: z.string().optional(),
      using: z.array(z.string()).default([...DEFAULT_JMAP_USING]),
      ops: z.string().optional(),
      ops_file: z.string().optional(),
      vars: z
        .record(z.string().regex(USER_VAR_KEY_RE), z.string())
        .optional(),
      dry_run: z.boolean().optional(),
      attachments: z
        .array(
          z.object({
            path: z.string(),
            filename: z.string().optional(),
            content_type: z.string().optional(),
          }),
        )
        .optional(),
    }),
    func: async ({
      credentials_dir,
      using,
      ops,
      ops_file,
      vars,
      dry_run,
      attachments,
    }) => {
      if (ops && ops_file) {
        throw new Error(sharedError("mcp_ops_mutually_exclusive"));
      }
      if (!ops && !ops_file) {
        throw new Error(sharedError("mcp_ops_required"));
      }
      if (dry_run === true && attachments && attachments.length > 0) {
        throw new Error(sharedError("cli_dry_run_with_attachment"));
      }

      const session = await resolveToolkitSession(ctx, credentials_dir, "jmap");
      const rawOps = ops_file
        ? await readOpsFile(session.credentialDir, ops_file)
        : ops!;
      const sourceLabel = ops_file ? `ops_file '${ops_file}'` : "ops";
      const { ok, status, bodyText } = await runJmapRequest({
        session,
        opsJson: rawOps,
        defaultUsing: using,
        sourceLabel,
        vars,
        dryRun: dry_run,
        attachments: attachments?.map((item: {
          path: string;
          filename?: string;
          content_type?: string;
        }) => ({
          path: item.path,
          filename: item.filename,
          contentType: item.content_type,
        })),
      });
      if (!ok) {
        throw new Error(`JMAP request failed (HTTP ${status}): ${bodyText}`);
      }
      return bodyText;
    },
  });
}

function buildHelpTool(): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "help",
    description: "Built-in Atomic Mail docs. Call early and often. Topics: " +
      `${HELP_TOPIC_LIST.join(", ")}, readme.`,
    schema: z.object({
      topic: z.string().optional(),
    }),
    func: async ({ topic }) => {
      return await getHelp(topic, "skill");
    },
  });
}

export function buildAtomicMailTools(
  context: AtomicMailToolkitContext,
): DynamicStructuredTool[] {
  return [
    buildRegisterTool(context),
    buildJmapRequestTool(context),
    buildHelpTool(),
  ];
}

export async function createAtomicMailTools(
  options: AtomicMailToolkitOptions = {},
): Promise<DynamicStructuredTool[]> {
  const toolkit = await AtomicMailToolkit.create(options);
  return toolkit.tools;
}

export class AtomicMailToolkit {
  readonly tools: DynamicStructuredTool[];
  private readonly context: AtomicMailToolkitContext;

  private constructor(context: AtomicMailToolkitContext) {
    this.context = context;
    this.tools = buildAtomicMailTools(context);
  }

  static async create(
    options: AtomicMailToolkitOptions = {},
  ): Promise<AtomicMailToolkit> {
    const context = options.context ?? (await createDefaultContext());
    return new AtomicMailToolkit(context);
  }

  get registerTool(): DynamicStructuredTool {
    return this.tools[0];
  }

  get jmapRequestTool(): DynamicStructuredTool {
    return this.tools[1];
  }

  get helpTool(): DynamicStructuredTool {
    return this.tools[2];
  }

  dispose(): void {
    this.context.defaultSession.destroy();
  }
}
