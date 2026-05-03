import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
  quotaTracker: {
    setEnabled: vi.fn(),
    dispose: vi.fn(),
  },
}));

vi.mock("node:child_process", () => ({
  spawnSync: mocks.spawnSync,
}));

vi.mock("../../../extensions/little-footer/codex-usage.ts", () => ({
  createCodexQuotaTracker: () => ({
    setEnabled: mocks.quotaTracker.setEnabled,
    getSnapshot: () => null,
    dispose: mocks.quotaTracker.dispose,
  }),
}));

type CommandHandler = (args: string, ctx: FakeCtx) => Promise<void> | void;
type SessionStartHandler = (event: unknown, ctx: FakeCtx) => void | Promise<void>;

interface FakeCtx {
  ui: {
    notify: ReturnType<typeof vi.fn>;
    setFooter: ReturnType<typeof vi.fn>;
  };
  cwd: string;
  model: { id: string; provider?: string } | undefined;
  sessionManager: {
    getBranch: () => unknown[];
  };
}

interface FakeFooterData {
  getGitBranch: () => string | null;
  getExtensionStatuses: () => Map<string, string>;
}

const originalEnv = { ...process.env };

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useRealTimers();
  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function createCtx(overrides: Partial<FakeCtx> = {}): FakeCtx {
  return {
    ui: {
      notify: vi.fn(),
      setFooter: vi.fn(),
    },
    cwd: "/Users/me/my-little-pi",
    model: { id: "anthropic/claude-sonnet-4-6" },
    sessionManager: {
      getBranch: () => [],
    },
    ...overrides,
  };
}

async function loadExtension(): Promise<{
  handlers: Map<string, SessionStartHandler>;
}> {
  const handlers = new Map<string, SessionStartHandler>();
  const pi = {
    getThinkingLevel: vi.fn().mockReturnValue("medium"),
    on: vi.fn((event: string, handler: SessionStartHandler) => {
      handlers.set(event, handler);
    }),
    registerCommand: vi.fn() as unknown as (
      name: string,
      options: {
        description?: string;
        handler: CommandHandler;
        getArgumentCompletions?: (prefix: string) => Array<{
          label: string;
          value: string;
        }> | null;
      },
    ) => void,
  };

  const { default: littleFooterExtension } = await import("../../../extensions/little-footer/index.ts");
  littleFooterExtension(pi as never);
  return { handlers };
}

describe("little-footer git diff caching", () => {
  it("reuses cached diff stats across renders until the ttl expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-29T12:00:00Z"));

    mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => {
      if (args[0] === "status") {
        return {
          status: 0,
          stdout: Buffer.from(" M extensions/little-footer/index.ts\n"),
        };
      }

      if (args[0] === "diff" && args.includes("HEAD")) {
        return {
          status: 0,
          stdout: Buffer.from("12\t3\textensions/little-footer/index.ts\n"),
        };
      }

      throw new Error(`unexpected git command: ${args.join(" ")}`);
    });

    const { handlers } = await loadExtension();
    const ctx = createCtx({
      cwd: "/Users/me/my-little-pi",
    });
    const footerData: FakeFooterData = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map(),
    };

    await handlers.get("session_start")?.({}, ctx);

    const factory = ctx.ui.setFooter.mock.calls[0][0] as (
      tui: unknown,
      theme: { fg: (role: string, text: string) => string },
      footerData: FakeFooterData,
    ) => { render: (width: number) => string[] };
    const theme = {
      fg: (_role: string, text: string) => text,
    };
    const component = factory({}, theme, footerData);

    const [firstLine] = component.render(120);
    expect(firstLine).toContain("+12");
    expect(firstLine).toContain("-3");
    expect(mocks.spawnSync).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1_000);
    component.render(120);
    expect(mocks.spawnSync).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(1_500);
    component.render(120);
    expect(mocks.spawnSync).toHaveBeenCalledTimes(5);

    vi.useRealTimers();
  });
});
