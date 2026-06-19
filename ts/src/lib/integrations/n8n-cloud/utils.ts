// n8n Cloud-safe async helpers (no setTimeout / restricted globals).

import { ONE_SEC_MS } from "../../core/consts.ts";
import type { MaybePromise } from "../../core/types.ts";

export function delay(ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = (): void => {
      if (Date.now() >= deadline) {
        resolve();
        return;
      }
      queueMicrotask(tick);
    };
    queueMicrotask(tick);
  });
}

export type RetryCfg = {
  maxTimeoutMs?: number;
  startTimeoutMs?: number;
  backoffMul?: number;
  onBeforeRetry?: (e: unknown) => MaybePromise<void>;
};

const defaultCfg: RetryCfg = {
  maxTimeoutMs: ONE_SEC_MS * 32,
  startTimeoutMs: ONE_SEC_MS,
  backoffMul: 2,
};

export async function retry<R>(
  fn: () => MaybePromise<R>,
  config: RetryCfg,
): Promise<R> {
  const cfg = { ...defaultCfg, ...config };
  let curTimeoutMs = cfg.startTimeoutMs!;

  while (true) {
    try {
      return await fn();
    } catch (e) {
      if (cfg.onBeforeRetry) await cfg.onBeforeRetry(e);
      if (curTimeoutMs > cfg.maxTimeoutMs!) throw e;
      await delay(curTimeoutMs);
      curTimeoutMs = Math.floor(curTimeoutMs * cfg.backoffMul!);
    }
  }
}
