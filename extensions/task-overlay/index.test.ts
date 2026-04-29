import { describe, expect, it, vi } from "vitest";

import taskOverlayExtension from "./index.ts";

function makePi() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const shortcuts = new Map<string, any>();
	const handlers = new Map<string, any>();
	const pi = {
		registerTool: vi.fn((tool: any) => tools.set(tool.name, tool)),
		registerCommand: vi.fn((name: string, command: any) => commands.set(name, command)),
		registerShortcut: vi.fn((shortcut: string, shortcutDef: any) => shortcuts.set(shortcut, shortcutDef)),
		on: vi.fn((event: string, handler: any) => handlers.set(event, handler)),
		sendMessage: vi.fn(async () => {}),
	};
	return { pi, tools, commands, shortcuts, handlers };
}

function makeCtx(entries: Array<any> = []) {
	const appendCustomEntry = vi.fn();
	const setStatus = vi.fn();
	const requestRender = vi.fn();
	const handles: Array<any> = [];
	const ui = {
		setStatus,
		custom: vi.fn(async (_factory: any, options: any) => {
			const hidden = { value: false };
			const handle = {
				setHidden: vi.fn((nextHidden: boolean) => {
					hidden.value = nextHidden;
				}),
				hide: vi.fn(),
				focus: vi.fn(),
				unfocus: vi.fn(),
				isHidden: vi.fn(() => hidden.value),
			};
			handles.push({ options, handle, factory: _factory });
			options?.onHandle?.(handle);
			return undefined;
		}),
	};
	return {
		ctx: {
			cwd: "/tmp/project",
			hasUI: true,
			ui,
			sessionManager: {
				getEntries: () => entries,
				appendCustomEntry,
			},
			model: undefined,
		},
		appendCustomEntry,
		setStatus,
		handles,
		requestRender,
	};
}

describe("task overlay extension", () => {
	it("registers the generic tasks tool and command surface", () => {
		const { pi } = makePi();
		taskOverlayExtension(pi as never);

		expect(pi.registerTool).toHaveBeenCalled();
		expect(pi.registerCommand).toHaveBeenCalled();
		expect(pi.registerShortcut).toHaveBeenCalled();
	});

	it("syncs tasks and persists state without forcing the floating panel open", async () => {
		const { pi, tools, handlers } = makePi();
		taskOverlayExtension(pi as never);
		const tool = tools.get("tasks") as any;
		expect(tool).toBeTruthy();

		const { ctx, appendCustomEntry, setStatus, handles } = makeCtx();
		const startHandler = handlers.get("session_start") as ((event: any, ctx: any) => Promise<void>) | undefined;
		await startHandler?.({ type: "session_start", reason: "startup" }, ctx);

		const result = await tool.execute("tool-1", { operation: "sync", input: "- [ ] Draft plan\n- [x] Implement overlay" }, undefined, undefined, ctx);

		expect(appendCustomEntry).toHaveBeenCalled();
		expect(setStatus).toHaveBeenCalledWith("tasks", expect.stringContaining("2"));
		expect(handles.length).toBe(0);
		expect(result.content).toMatchObject([{ type: "text", text: expect.stringContaining("synced") }]);
	});

	it("can reopen the panel after closing it", async () => {
		const { pi, tools, handlers } = makePi();
		taskOverlayExtension(pi as never);
		const tool = tools.get("tasks") as any;
		const { ctx, handles } = makeCtx();
		const startHandler = handlers.get("session_start") as ((event: any, ctx: any) => Promise<void>) | undefined;
		await startHandler?.({ type: "session_start", reason: "startup" }, ctx);

		await tool.execute("tool-1", { operation: "sync", input: "- [ ] Draft plan" }, undefined, undefined, ctx);
		await tool.execute("tool-2", { operation: "show" }, undefined, undefined, ctx);
		const handle = handles[0]?.handle;
		const component = handles[0]?.factory({ requestRender: vi.fn() }, { fg: (_: string, text: string) => text, bold: (text: string) => text, dim: (text: string) => text });
		component.handleInput("\u001b");
		expect(handle.setHidden).toHaveBeenCalledWith(true);

		await tool.execute("tool-3", { operation: "show" }, undefined, undefined, ctx);
		expect(handle.setHidden).toHaveBeenCalledWith(false);
	});

	it("clears all tasks from the agent tool", async () => {
		const { pi, tools, handlers } = makePi();
		taskOverlayExtension(pi as never);
		const tool = tools.get("tasks") as any;
		const { ctx, appendCustomEntry, setStatus } = makeCtx();
		const startHandler = handlers.get("session_start") as ((event: any, ctx: any) => Promise<void>) | undefined;
		await startHandler?.({ type: "session_start", reason: "startup" }, ctx);

		await tool.execute("tool-1", { operation: "sync", input: "- [ ] Draft plan\n- [ ] Ship" }, undefined, undefined, ctx);
		const result = await tool.execute("tool-2", { operation: "clear" }, undefined, undefined, ctx);

		expect(result.content).toMatchObject([{ type: "text", text: "cleared 2 tasks" }]);
		expect(result.details.tasks).toEqual([]);
		expect(appendCustomEntry).toHaveBeenLastCalledWith("task-overlay", { kind: "replace", tasks: [] });
		expect(setStatus).toHaveBeenLastCalledWith("tasks", undefined);
	});

	it("clears all tasks from user commands", async () => {
		const { pi, tools, commands, handlers } = makePi();
		taskOverlayExtension(pi as never);
		const tool = tools.get("tasks") as any;
		const tasksCommand = commands.get("tasks") as any;
		const clearCommand = commands.get("clear-tasks") as any;
		const { ctx } = makeCtx();
		const startHandler = handlers.get("session_start") as ((event: any, ctx: any) => Promise<void>) | undefined;
		await startHandler?.({ type: "session_start", reason: "startup" }, ctx);

		await tool.execute("tool-1", { operation: "sync", input: "- [ ] Draft plan" }, undefined, undefined, ctx);
		await tasksCommand.handler("clear", ctx);
		expect((await tool.execute("tool-2", { operation: "snapshot" }, undefined, undefined, ctx)).content[0].text).toBe("no tasks");

		await tool.execute("tool-3", { operation: "sync", input: "- [ ] Draft plan" }, undefined, undefined, ctx);
		await clearCommand.handler("", ctx);
		expect((await tool.execute("tool-4", { operation: "snapshot" }, undefined, undefined, ctx)).content[0].text).toBe("no tasks");
	});

	it("autocompletes task command subcommands", () => {
		const { pi, commands } = makePi();
		taskOverlayExtension(pi as never);
		const tasksCommand = commands.get("tasks") as any;

		expect(tasksCommand.getArgumentCompletions("")).toEqual([
			{ value: "clear", label: "clear", description: "Clear all tasks" },
			{ value: "clear-all", label: "clear-all", description: "Clear all tasks" },
		]);
		expect(tasksCommand.getArgumentCompletions("clear-a")).toEqual([{ value: "clear-all", label: "clear-all", description: "Clear all tasks" }]);
		expect(tasksCommand.getArgumentCompletions("unknown")).toBeNull();
	});
});
