#!/usr/bin/env -S deno run -A
/**
 * Dev helper: send one email with a synthetic large attachment (or smoke-test paths).
 *
 * **Default:** RFC 8620 upload via `runJmapRequest` + bundled
 * `send_mail_blob_attachment.json` (same as MCP / skill `attachments`).
 *
 * **`--in-band`:** `send_mail_attachment.json` (`Blob/upload` in the JMAP batch).
 *
 * **`--plain`:** `send_mail.json` only (no blob).
 *
 * From repository `ts/`:
 *   deno run -A src/bin/send-big-attachment.ts [--bytes N] [--to addr] [--in-band]
 *   deno run -A src/bin/send-big-attachment.ts --plain [--to addr]
 */
import { Buffer } from "node:buffer";

import {
  AgentSession,
  DEFAULT_JMAP_USING,
  assertBlobUploadSizesNonZero,
  assertJmapSubmissionCreated,
  inboxIdToMailboxEmail,
  readOpsFile,
  resolveAgentConfigFromEnv,
  runJmapRequest,
} from "../lib/mod.ts";

const DEFAULT_BYTES = 1_048_576;

function parseArgs(): {
  bytes: number;
  to?: string;
  inBand: boolean;
  plain: boolean;
} {
  let bytes = DEFAULT_BYTES;
  let to: string | undefined;
  let inBand = false;
  let plain = false;
  const a = Deno.args;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--bytes" && a[i + 1]) {
      bytes = Math.max(1, parseInt(a[++i], 10));
    } else if (a[i] === "--to" && a[i + 1]) {
      to = a[++i];
    } else if (a[i] === "--in-band") {
      inBand = true;
    } else if (a[i] === "--plain") {
      plain = true;
    }
  }
  return { bytes, to, inBand, plain };
}

async function sendOutOfBandViaAttachments(
  session: AgentSession,
  credentialDir: string,
  addr: string,
  bytes: Uint8Array,
): Promise<void> {
  const tmp = await Deno.makeTempFile({ suffix: ".txt" });
  try {
    await Deno.writeFile(tmp, bytes);
    const raw = await readOpsFile(credentialDir, "send_mail_blob_attachment.json");
    const { ok, status, bodyText } = await runJmapRequest({
      session,
      opsJson: raw,
      defaultUsing: [...DEFAULT_JMAP_USING],
      sourceLabel: "send-big-attachment (oob via attachments)",
      vars: {
        INBOX: addr,
        TO: addr,
        SUBJECT: `Large attachment (${bytes.length} bytes, RFC 8620 upload)`,
        BODY: "Body text; see attachment.",
      },
      attachments: [
        {
          path: tmp,
          filename: `payload-${bytes.length}.txt`,
          contentType: "text/plain",
        },
      ],
    });
    if (!ok) {
      console.error(`JMAP failed HTTP ${status}`);
      console.error(bodyText);
      Deno.exit(1);
    }
    assertJmapSubmissionCreated(bodyText);
    console.log(bodyText);
  } finally {
    await Deno.remove(tmp).catch(() => {});
  }
}

async function sendPlain(
  session: AgentSession,
  credentialDir: string,
  addr: string,
): Promise<void> {
  const raw = await readOpsFile(credentialDir, "send_mail.json");
  const { ok, status, bodyText } = await runJmapRequest({
    session,
    opsJson: raw,
    defaultUsing: [...DEFAULT_JMAP_USING],
    sourceLabel: "send_mail.json",
    vars: {
      INBOX: addr,
      TO: addr,
      SUBJECT: "send-big-attachment --plain smoke test",
      BODY: "Plain send (no attachment). If you see this, JMAP submission works.",
    },
  });
  if (!ok) {
    console.error(`JMAP failed HTTP ${status}`);
    console.error(bodyText);
    Deno.exit(1);
  }
  assertJmapSubmissionCreated(bodyText);
  console.log(bodyText);
}

async function sendInBand(
  session: AgentSession,
  credentialDir: string,
  addr: string,
  payload: Uint8Array,
): Promise<void> {
  const attachmentBase64 = Buffer.from(payload).toString("base64");

  const raw = await readOpsFile(
    credentialDir,
    "send_mail_attachment.json",
  );

  const { ok, status, bodyText } = await runJmapRequest({
    session,
    opsJson: raw,
    defaultUsing: [...DEFAULT_JMAP_USING],
    sourceLabel: "send_mail_attachment.json",
    vars: {
      INBOX: addr,
      TO: addr,
      SUBJECT: `Large attachment (${payload.length} bytes, in-band Blob/upload)`,
      BODY: "See attached text file.",
      ATTACHMENT_BASE64: attachmentBase64,
      ATTACHMENT_TYPE: "text/plain",
      ATTACHMENT_NAME: `blob-${payload.length}.txt`,
    },
  });

  if (!ok) {
    console.error(`JMAP failed HTTP ${status}`);
    console.error(bodyText);
    Deno.exit(1);
  }
  assertBlobUploadSizesNonZero(bodyText, payload.length);
  assertJmapSubmissionCreated(bodyText);
  console.log(bodyText);
}

async function main(): Promise<void> {
  const { bytes, to: toFlag, inBand, plain } = parseArgs();
  const config = await resolveAgentConfigFromEnv();
  const session = await AgentSession.create({
    authUrl: config.authUrl,
    apiUrl: config.apiUrl,
    scryptSalt: config.scryptSalt,
    apiKey: config.apiKey,
    inboxId: config.inboxId,
    credentialDir: config.credentialDir,
    files: config.files,
  });

  const inbox = session.currentInboxId;
  if (!inbox) {
    throw new Error("No inbox in session; run register first.");
  }
  const addr = toFlag ?? inboxIdToMailboxEmail(inbox);

  try {
    if (plain) {
      await sendPlain(session, config.credentialDir, addr);
    } else {
      const body = new Uint8Array(bytes);
      body.fill("x".charCodeAt(0));
      if (inBand) {
        await sendInBand(session, config.credentialDir, addr, body);
      } else {
        try {
          await sendOutOfBandViaAttachments(
            session,
            config.credentialDir,
            addr,
            body,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("404")) {
            console.error(msg);
            console.error(
              "\nTip: run `deno run -A src/bin/send-big-attachment.ts --plain` " +
                "to verify plain send; fix server Blob/upload + uploadUrl for attachments.",
            );
            Deno.exit(1);
          }
          throw e;
        }
      }
    }
  } finally {
    session.destroy();
  }
}

await main();
