import { describe, expect, it, vi } from "vitest";

const sessionManagerMock = vi.hoisted(() => ({
  listAll: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
  SessionManager: sessionManagerMock,
  VERSION: "test-version",
}));

const theme = {
  fg: (_role: string, text: string) => text,
  bg: (_role: string, text: string) => text,
  bold: (text: string) => text,
};

describe("startup-screen extension", () => {
  it("loads a selected recent session with ctrl+enter, not plain enter", async () => {
    sessionManagerMock.listAll.mockResolvedValue([
      {
        path: "/sessions/one.json",
        modified: new Date("2026-05-12T10:00:00Z"),
        cwd: "/Users/me/project-one",
        name: "First session",
      },
      {
        path: "/sessions/two.json",
        modified: new Date("2026-05-13T10:00:00Z"),
        cwd: "/Users/me/project-two",
        firstMessage: "Second session",
      },
    ]);

    let terminalInputHandler: ((data: string) => { consume?: boolean; data?: string } | undefined) | undefined;
    let headerFactory: any;
    const ctx = {
      hasUI: true,
      model: { name: "test model", provider: "test provider" },
      ui: {
        getEditorText: vi.fn(() => ""),
        onTerminalInput: vi.fn((handler: typeof terminalInputHandler) => {
          terminalInputHandler = handler;
          return vi.fn();
        }),
        setEditorText: vi.fn(),
        setHeader: vi.fn((factory: any) => {
          headerFactory = factory;
        }),
      },
    };
    const handlers = new Map<string, any>();
    const commands = new Map<string, any>();
    const pi = {
      on: vi.fn((event: string, handler: any) => handlers.set(event, handler)),
      registerCommand: vi.fn((name: string, options: any) => commands.set(name, options)),
    };
    const { default: extension } = await import("../../../extensions/startup-screen/index.ts");

    extension(pi as never);
    await handlers.get("session_start")?.({}, ctx);
    const header = headerFactory({ requestRender: vi.fn() }, theme);

    expect(header.render(100).join("\n")).toContain("ctrl + enter load");
    expect(terminalInputHandler?.("\r")).toBeUndefined();
    expect(ctx.ui.setEditorText).not.toHaveBeenCalled();

    const result = terminalInputHandler?.("\x1b[13;5u");

    expect(ctx.ui.setEditorText).toHaveBeenCalledWith("/recent 0");
    expect(result).toEqual({ data: "\r" });

    const commandCtx = {
      ...ctx,
      switchSession: vi.fn(),
    };
    await commands.get("recent")?.handler("0", commandCtx);

    expect(commandCtx.switchSession).toHaveBeenCalledWith("/sessions/two.json");
  });
});
