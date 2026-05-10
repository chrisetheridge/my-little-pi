import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function createJwt(payload: unknown): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encodedPayload}.signature`;
}

describe("createCodexQuotaTracker", () => {
  it("loads ChatGPT Codex usage with model-registry auth and keeps the refresh cache", async () => {
    process.env.CHATGPT_BASE_URL = "https://chatgpt.test/backend-api/";
    const token = createJwt({
      "https://api.openai.com/auth": {
        chatgpt_account_id: "account-123",
      },
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      rate_limit: {
        primary_window: {
          used_percent: 25,
          limit_window_seconds: 5 * 60 * 60,
          reset_at: 1_800_000_000,
        },
        secondary_window: {
          used_percent: 10,
          limit_window_seconds: 7 * 24 * 60 * 60,
          reset_at: 1_800_100_000,
        },
      },
    }), { status: 200 }));
    globalThis.fetch = fetchMock;

    const { createCodexQuotaTracker } = await import("../../../extensions/little-footer/codex-usage.ts");
    const onUpdate = vi.fn();
    const ctx = {
      model: { id: "codex-2", provider: "openai-codex" },
      modelRegistry: {
        getApiKeyAndHeaders: vi.fn(async () => ({
          ok: true,
          apiKey: token,
          headers: { "x-extra": "1" },
        })),
      },
    };

    const tracker = createCodexQuotaTracker(ctx as never, onUpdate);
    tracker.setEnabled(true);

    await vi.waitFor(() => {
      expect(tracker.getSnapshot()).not.toBeNull();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://chatgpt.test/backend-api/wham/usage");
    const headers = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
    expect(headers.get("chatgpt-account-id")).toBe("account-123");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("x-extra")).toBe("1");
    expect(tracker.getSnapshot()).toEqual({
      limitId: "codex",
      limitName: "OpenAI",
      primary: {
        usedPercent: 25,
        windowDurationMins: 300,
        resetsAt: 1_800_000_000_000,
      },
      secondary: {
        usedPercent: 10,
        windowDurationMins: 10080,
        resetsAt: 1_800_100_000_000,
      },
    });
    expect(onUpdate).toHaveBeenCalledTimes(1);

    tracker.setEnabled(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    tracker.dispose();
  });
});
