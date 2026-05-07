import { ONE_SEC_MS } from "./consts.ts";
import type { MaybePromise } from "./types.ts";

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type RetryCfg = {
  maxTimeoutMs?: number;
  startTimeoutMs?: number;
  backoffMul?: number;
  // please, do not throw in this
  onBeforeRetry?: (e: unknown) => MaybePromise<void>;
};

const defaultCfg: RetryCfg = {
  maxTimeoutMs: ONE_SEC_MS * 32,
  startTimeoutMs: ONE_SEC_MS,
  backoffMul: 2,
};

// retry with exponential backoff, retries the fn on throw, re-throws on max backoff
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
