import { afterEach, describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@mariozechner/pi-tui";

type CommandHandler = (args: string, ctx: FakeCtx) => Promise<void> | void;
type SessionStartHandler = (event: unknown, ctx: FakeCtx) => void | Promise<void>;

interface FakeCtx {
  ui: {
    notify: ReturnType<typeof vi.fn>;
    setFooter: ReturnType<typeof vi.fn>;
  };
  cwd: string;
  model: { id: string } | undefined;
  sessionManager: {
    getBranch: () => unknown[];
  };
  getContextUsage: () =>
    | { percent: number | null; contextWindow: number | null }
    | undefined;
}

interface FakeFooterData {
  getGitBranch: () => string | null;
  getExtensionStatuses: () => Map<string, string>;
}

interface LoadedExtension {
  commands: Map<
    string,
    {
      description?: string;
      handler: CommandHandler;
      getArgumentCompletions?: (prefix: string) => Array<{
        label: string;
        value: string;
      }> | null;
    }
  >;
  handlers: Map<string, SessionStartHandler>;
}

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
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
    getContextUsage: () => undefined,
    ...overrides,
  };
}

async function loadExtension(env: Record<string, string> = {}): Promise<LoadedExtension> {
  Object.assign(process.env, env);

  const commands = new Map<
    string,
    {
      description?: string;
      handler: CommandHandler;
      getArgumentCompletions?: (prefix: string) => Array<{
        label: string;
        value: string;
      }> | null;
    }
  >();
  const handlers = new Map<string, SessionStartHandler>();

  const loadPi = () => {
    const getThinkingLevel = vi.fn().mockReturnValue("medium");
    const on = vi.fn((event: string, handler: SessionStartHandler) => {
      handlers.set(event, handler);
    });
    const registerCommand = vi.fn(
      (
        name: string,
        options: {
          description?: string;
          handler: CommandHandler;
          getArgumentCompletions?: (prefix: string) => Array<{
            label: string;
            value: string;
          }> | null;
        },
      ) => {
        commands.set(name, options);
      },
    );

    return { getThinkingLevel, on, registerCommand };
  };

  const pi = loadPi();
  const { default: littleFooterExtension } = await import("./index.ts");
  littleFooterExtension(pi as never);

  return { commands, handlers };
}

describe("little-footer extension", () => {
  it("registers session_start and footer command", async () => {
    const { commands, handlers } = await loadExtension({
      LITTLE_FOOTER_NERD_FONTS: "0",
    });

    expect(handlers.has("session_start")).toBe(true);
    expect(commands.has("footer")).toBe(true);
  });

  it("auto-enables the footer on session_start", async () => {
    const { handlers } = await loadExtension({
      LITTLE_FOOTER_NERD_FONTS: "0",
    });
    const ctx = createCtx();

    await handlers.get("session_start")?.({}, ctx);

    expect(ctx.ui.setFooter).toHaveBeenCalledTimes(1);
    expect(typeof ctx.ui.setFooter.mock.calls[0][0]).toBe("function");
  });

  it("reports status and icon mode", async () => {
    const { commands } = await loadExtension({
      LITTLE_FOOTER_NERD_FONTS: "0",
    });
    const ctx = createCtx();
    const command = commands.get("footer");

    expect(command).toBeDefined();
    await command?.handler("status", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "little-footer: on (ascii icons)",
      "info",
    );
  });

  it("reports off after disabling the footer", async () => {
    const { commands } = await loadExtension({
      LITTLE_FOOTER_NERD_FONTS: "1",
    });
    const ctx = createCtx();
    const command = commands.get("footer");

    expect(command).toBeDefined();
    await command?.handler("off", ctx);
    await command?.handler("status", ctx);

    expect(ctx.ui.setFooter).toHaveBeenCalledWith(undefined);
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("little-footer: off (nerd icons)", "info");
  });

  it("re-enables the footer after turning it off", async () => {
    const { handlers, commands } = await loadExtension({
      LITTLE_FOOTER_NERD_FONTS: "0",
    });
    const ctx = createCtx();
    const sessionStart = handlers.get("session_start");
    const command = commands.get("footer");

    await sessionStart?.({}, ctx);
    await command?.handler("off", ctx);
    await command?.handler("on", ctx);

    expect(ctx.ui.setFooter).toHaveBeenCalledTimes(3);
    expect(ctx.ui.setFooter.mock.calls[1]).toEqual([undefined]);
    expect(typeof ctx.ui.setFooter.mock.calls[2][0]).toBe("function");
    expect(ctx.ui.notify).toHaveBeenLastCalledWith("little-footer: on", "info");
  });

  it("exposes completion options", async () => {
    const { commands } = await loadExtension();
    const command = commands.get("footer");

    expect(command?.getArgumentCompletions?.("")).toEqual([
      { label: "on", value: "on" },
      { label: "off", value: "off" },
      { label: "status", value: "status" },
    ]);
    expect(command?.getArgumentCompletions?.("st")).toEqual([
      { label: "status", value: "status" },
    ]);
  });

  it("renders the footer line with all active segments", async () => {
    const { handlers } = await loadExtension({
      LITTLE_FOOTER_NERD_FONTS: "0",
    });
    const ctx = createCtx({
      cwd: "/Users/me/my-little-pi/",
      getContextUsage: () => ({ percent: 25, contextWindow: 200000 }),
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "assistant",
              usage: {
                input: 1000,
                output: 234,
                cost: { total: 0.05 },
              },
            },
          },
        ],
      },
    });
    const footerData: FakeFooterData = {
      getGitBranch: () => "main",
      getExtensionStatuses: () => new Map([["caveman", "caveman:full"]]),
    };

    await handlers.get("session_start")?.({}, ctx);

    const factory = ctx.ui.setFooter.mock.calls[0][0] as (
      tui: unknown,
      theme: { fg: (role: string, text: string) => string },
      footerData: FakeFooterData,
    ) => { render: (width: number) => string[] };

    const theme = {
      fg: (_role: string, text: string) => `\u001b[32m${text}\u001b[0m`,
    };
    const component = factory({}, theme, footerData);
    const [line] = component.render(200);

    expect(line).toContain("Anthropic: Claude Sonnet 4 6");
    expect(line).toContain("my-little-pi");
    expect(line).toContain("main");
    expect(line).toContain("1.2k");
    expect(line).toContain("$0.050");
    expect(line).toContain("25.0%/200000");
    expect(line).toContain("caveman:full");
    expect(visibleWidth(line)).toBeLessThanOrEqual(200);
  });

  it("shows dirty indicator when git repo has uncommitted changes", async () => {
    const { handlers } = await loadExtension({
      LITTLE_FOOTER_NERD_FONTS: "0",
    });
    const ctx = createCtx({
      cwd: "/Users/chrise/code/private/my-little-pi",
      getContextUsage: () => undefined,
      sessionManager: { getBranch: () => [] },
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
      fg: (_role: string, text: string) => `\u001b[32m${text}\u001b[0m`,
    };
    const component = factory({}, theme, footerData);
    const [line] = component.render(200);

    // Untracked files can suppress diff counts; either the counts or the dirty marker are acceptable.
    expect(line).toMatch(/\+\d+|!|\*/);
    expect(line).toMatch(/-\d+|!|\*/);
  });

  it("truncates the rendered line to the requested width", async () => {
    const { handlers } = await loadExtension({
      LITTLE_FOOTER_NERD_FONTS: "0",
    });
    const ctx = createCtx({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "assistant",
              usage: {
                input: 1500,
                output: 500,
                cost: { total: 1.5 },
              },
            },
          },
        ],
      },
      getContextUsage: () => ({ percent: 90, contextWindow: 200000 }),
    });
    const footerData: FakeFooterData = {
      getGitBranch: () => "feature/footer",
      getExtensionStatuses: () => new Map([["status", "building..."]]),
    };

    await handlers.get("session_start")?.({}, ctx);

    const factory = ctx.ui.setFooter.mock.calls[0][0] as (
      tui: unknown,
      theme: { fg: (role: string, text: string) => string },
      footerData: FakeFooterData,
    ) => { render: (width: number) => string[] };
    const theme = {
      fg: (_role: string, text: string) => `\u001b[36m${text}\u001b[0m`,
    };
    const component = factory({}, theme, footerData);
    const [line] = component.render(40);

    expect(visibleWidth(line)).toBeLessThanOrEqual(40);
  });

  it("keeps invalidate usable even when called detached from the component", async () => {
    const { handlers } = await loadExtension({
      LITTLE_FOOTER_NERD_FONTS: "0",
    });
    const ctx = createCtx();

    await handlers.get("session_start")?.({}, ctx);

    const factory = ctx.ui.setFooter.mock.calls[0][0] as (
      tui: unknown,
      theme: { fg: (role: string, text: string) => string },
      footerData: FakeFooterData,
    ) => { invalidate: () => void };

    const component = factory(
      {},
      { fg: (_role: string, text: string) => text },
      {
        getGitBranch: () => null,
        getExtensionStatuses: () => new Map(),
      },
    );

    const { invalidate } = component;
    expect(() => invalidate()).not.toThrow();
  });

  it("warns on unknown subcommands", async () => {
    const { commands } = await loadExtension();
    const ctx = createCtx();
    const command = commands.get("footer");

    await command?.handler("maybe", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      'little-footer: unknown subcommand "maybe". Use on|off|status.',
      "warning",
    );
  });
});
