/**
 * Codex CLI RPC quota tracker.
 */

import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

export interface QuotaWindowSnapshot {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface QuotaSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: QuotaWindowSnapshot | null;
  secondary: QuotaWindowSnapshot | null;
}

export interface QuotaTracker {
  setEnabled: (enabled: boolean) => void;
  getSnapshot: () => QuotaSnapshot | null;
  dispose: () => void;
}

interface GetAccountRateLimitsResponse {
  rateLimits: {
    limitId: string | null;
    limitName: string | null;
    primary: QuotaWindowSnapshot | null;
    secondary: QuotaWindowSnapshot | null;
  };
  rateLimitsByLimitId: Record<string, {
    limitId: string | null;
    limitName: string | null;
    primary: QuotaWindowSnapshot | null;
    secondary: QuotaWindowSnapshot | null;
  } | undefined> | null;
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface JsonRpcResponse<T> {
  id?: string | number;
  result?: T;
  error?: JsonRpcError;
  method?: string;
  params?: unknown;
}

const CODEX_RPC_ARGS = ["-s", "read-only", "-a", "untrusted", "app-server"] as const;
const CODEX_CLIENT_INFO = {
  name: "little-footer",
  title: "Pi footer",
  version: "0.1.0",
};
const REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;

function isQuotaWindowSnapshot(value: unknown): value is QuotaWindowSnapshot {
  if (!value || typeof value !== "object") return false;
  const window = value as QuotaWindowSnapshot;
  return typeof window.usedPercent === "number";
}

function extractQuotaSnapshot(payload: GetAccountRateLimitsResponse): QuotaSnapshot | null {
  const preferred = payload.rateLimitsByLimitId?.codex ?? payload.rateLimits;
  if (!preferred) return null;

  return {
    limitId: preferred.limitId ?? null,
    limitName: preferred.limitName ?? null,
    primary: isQuotaWindowSnapshot(preferred.primary) ? preferred.primary : null,
    secondary: isQuotaWindowSnapshot(preferred.secondary) ? preferred.secondary : null,
  };
}

function parseJsonRpcResponse<T>(line: string): JsonRpcResponse<T> | null {
  try {
    const value = JSON.parse(line) as JsonRpcResponse<T>;
    if (!value || typeof value !== "object") return null;
    return value;
  } catch {
    return null;
  }
}

function createCodexRpcClient(onLine: (line: string) => void): {
  write: (message: unknown) => void;
  close: () => void;
} | null {
  const binary = process.env.CODEX_BIN || "codex";
  const child = spawn(binary, [...CODEX_RPC_ARGS], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  if (!child.stdin || !child.stdout) {
    child.kill();
    return null;
  }

  child.on("error", () => {
    child.kill();
  });

  const stdout = createInterface({ input: child.stdout });
  stdout.on("line", onLine);

  const close = () => {
    stdout.close();
    child.kill();
  };

  return {
    write(message: unknown) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    close,
  };
}

async function readCodexQuotaSnapshot(): Promise<QuotaSnapshot | null> {
  return await new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let rpc: ReturnType<typeof createCodexRpcClient> | null = null;

    const finish = (snapshot: QuotaSnapshot | null) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      rpc?.close();
      resolve(snapshot);
    };

    const handleLine = (line: string) => {
      const message = parseJsonRpcResponse<unknown>(line);
      if (!message) return;

      if (message.id === 1 && message.result) {
        rpc?.write({ method: "initialized" });
        rpc?.write({ method: "account/rateLimits/read", id: 2 });
        return;
      }

      if (message.id === 2) {
        if (message.error) {
          finish(null);
          return;
        }
        const snapshot = extractQuotaSnapshot(message.result as GetAccountRateLimitsResponse);
        finish(snapshot);
      }
    };

    rpc = createCodexRpcClient(handleLine);
    if (!rpc) {
      finish(null);
      return;
    }

    timeout = setTimeout(() => finish(null), REQUEST_TIMEOUT_MS);

    rpc.write({
      method: "initialize",
      id: 1,
      params: {
        clientInfo: CODEX_CLIENT_INFO,
        capabilities: { experimentalApi: false },
      },
    });
  });
}

export function createCodexQuotaTracker(onUpdate: () => void): QuotaTracker {
  let enabled = false;
  let snapshot: QuotaSnapshot | null = null;
  let lastRefreshAt = 0;
  let refreshInFlight: Promise<void> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let disposed = false;

  const refresh = async (): Promise<void> => {
    if (disposed || refreshInFlight) return;

    refreshInFlight = (async () => {
      const next = await readCodexQuotaSnapshot();
      const previous = snapshot ? JSON.stringify(snapshot) : null;
      const current = next ? JSON.stringify(next) : null;
      snapshot = next;
      lastRefreshAt = Date.now();
      if (previous !== current) {
        onUpdate();
      }
    })().finally(() => {
      refreshInFlight = null;
    });

    await refreshInFlight;
  };

  const stopInterval = (): void => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
  };

  const startInterval = (): void => {
    if (interval) return;
    interval = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
  };

  return {
    setEnabled(nextEnabled: boolean): void {
      enabled = nextEnabled;
      if (!enabled) {
        stopInterval();
        return;
      }

      startInterval();
      if (!snapshot || Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS) {
        void refresh();
      }
    },
    getSnapshot(): QuotaSnapshot | null {
      return snapshot;
    },
    dispose(): void {
      disposed = true;
      stopInterval();
    },
  };
}
