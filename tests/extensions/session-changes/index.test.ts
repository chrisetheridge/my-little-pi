import { describe, expect, it, vi } from "vitest";
import {
  applyToolResult,
  countContentLines,
  countDiffLines,
  createSessionChangesState,
  getChangedFiles,
  normalizeToolPath,
  rebuildFromSessionEntries,
  SessionChangesWidget,
} from "../../../extensions/session-changes/index.ts";

describe("session-changes extension", () => {
  it("normalizes tool paths relative to cwd", () => {
    expect(normalizeToolPath("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
    expect(normalizeToolPath("/repo", "@src/a.ts")).toBe("src/a.ts");
    expect(normalizeToolPath("/repo", "/other/a.ts")).toBe("/other/a.ts");
    expect(normalizeToolPath("/repo", "")).toBeUndefined();
  });

  it("counts added and deleted diff lines without file headers", () => {
    expect(
      countDiffLines("--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-old\n+new\n context"),
    ).toEqual({ added: 1, deleted: 1 });
  });

  it("counts write content lines", () => {
    expect(countContentLines("")).toBe(0);
    expect(countContentLines("one")).toBe(1);
    expect(countContentLines("one\ntwo\n")).toBe(2);
  });

  it("tracks edit and write tool results in most-recent order", () => {
    const state = createSessionChangesState();

    applyToolResult(state, "/repo", {
      toolName: "edit",
      input: { path: "src/a.ts" },
      details: { diff: "-old\n+new\n+extra" },
      isError: false,
    } as never);
    applyToolResult(state, "/repo", {
      toolName: "write",
      input: { path: "src/b.ts", content: "one\ntwo" },
      details: undefined,
      isError: false,
    } as never);
    applyToolResult(state, "/repo", {
      toolName: "edit",
      input: { path: "src/a.ts" },
      details: { diff: "+again" },
      isError: false,
    } as never);

    const files = getChangedFiles(state);
    expect(files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files[0]).toMatchObject({ added: 3, deleted: 1, touches: 2 });
    expect(files[1]).toMatchObject({ added: 2, deleted: 0, touches: 1 });
  });

  it("rebuilds state from persisted assistant tool calls and tool-result messages", () => {
    const state = createSessionChangesState();

    rebuildFromSessionEntries(state, "/repo", [
      { type: "message", message: { role: "user", content: [] } },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "edit-1",
              name: "edit",
              arguments: { path: "/repo/src/a.ts" },
            },
            {
              type: "toolCall",
              id: "bash-1",
              name: "bash",
              arguments: { command: "echo ignored > src/c.ts" },
            },
            {
              type: "toolCall",
              id: "write-1",
              name: "write",
              arguments: { path: "src/b.ts", content: "one" },
            },
          ],
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "edit-1",
          toolName: "edit",
          details: { diff: "-old\n+new" },
          isError: false,
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "bash-1",
          toolName: "bash",
          isError: false,
        },
      },
      {
        type: "message",
        message: {
          role: "toolResult",
          toolCallId: "write-1",
          toolName: "write",
          isError: false,
        },
      },
    ]);

    expect(getChangedFiles(state).map((file) => file.path)).toEqual(["src/b.ts", "src/a.ts"]);
  });

  it("renders a compact widget without edit contents", () => {
    const state = createSessionChangesState();
    applyToolResult(state, "/repo", {
      toolName: "edit",
      input: { path: "src/a.ts" },
      details: { diff: "-secret old line\n+secret new line" },
      isError: false,
    } as never);

    const theme = {
      fg: (_role: string, text: string) => text,
      bold: (text: string) => text,
    };
    const widget = new SessionChangesWidget(state, theme);
    const rendered = widget.render(80).join("\n");

    expect(rendered).toContain("Changed this session");
    expect(rendered).toContain("src/a.ts");
    expect(rendered).toContain("+1");
    expect(rendered).toContain("-1");
    expect(rendered).not.toContain("secret old line");
    expect(rendered).not.toContain("secret new line");
  });

  it("renders nothing before any Pi file changes", () => {
    const theme = {
      fg: (_role: string, text: string) => text,
      bold: (text: string) => text,
    };
    const widget = new SessionChangesWidget(createSessionChangesState(), theme);

    expect(widget.render(80)).toEqual([]);
  });

  it("registers the persistent widget and updates after tool results", async () => {
    const handlers = new Map<string, any>();
    const pi = {
      on: vi.fn((event: string, handler: any) => handlers.set(event, handler)),
    };
    const { default: extension } = await import("../../../extensions/session-changes/index.ts");
    extension(pi as never);

    let widgetFactory: any;
    const requestRender = vi.fn();
    const ctx = {
      cwd: "/repo",
      hasUI: true,
      sessionManager: { getBranch: () => [] },
      ui: {
        setWidget: vi.fn((_key: string, factory: any) => {
          widgetFactory = factory;
        }),
      },
    };

    await handlers.get("session_start")?.({}, ctx);
    const widget = widgetFactory({ requestRender }, { fg: (_role: string, text: string) => text, bold: (text: string) => text });

    await handlers.get("tool_result")?.(
      {
        toolName: "write",
        input: { path: "src/a.ts", content: "one" },
        details: undefined,
        isError: false,
      },
      ctx,
    );

    expect(requestRender).toHaveBeenCalled();
    expect(widget.render(80).join("\n")).toContain("src/a.ts");
  });
});
