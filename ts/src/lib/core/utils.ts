// Small async helpers (delay, exponential backoff retry).

import { ONE_SEC_MS } from "./consts.ts";
import type { MaybePromise } from "./types.ts";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RetryCfg = {
  maxTimeoutMs?: number;
  startTimeoutMs?: number;
  backoffMul?: number;
  /** Optional hook before the next retry; must not throw. */
  onBeforeRetry?: (e: unknown) => MaybePromise<void>;
};

const defaultCfg: RetryCfg = {
  maxTimeoutMs: ONE_SEC_MS * 32,
  startTimeoutMs: ONE_SEC_MS,
  backoffMul: 2,
};

/** Retries `fn` on throw with exponential backoff until `maxTimeoutMs` is exceeded. */
export async function retry<R>(
  fn: () => MaybePromise<R>,
  config: RetryCfg,
): Promise<R> {
  const cfg = { ...defaultCfg, ...config };
  let curTimeoutMs = cfg.startTimeoutMs!;

  while (true) {
    try {
      const res = await fn();
      return res;
    } catch (e) {
      if (cfg.onBeforeRetry) await cfg.onBeforeRetry(e);
      if (curTimeoutMs > cfg.maxTimeoutMs!) throw e;

      await delay(curTimeoutMs);
      curTimeoutMs = Math.floor(curTimeoutMs * cfg.backoffMul!);
    }
  }
}
