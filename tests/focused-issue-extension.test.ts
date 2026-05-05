import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createFocusedIssueExtension } from "../extensions/focused-issue/index.ts";
import type { FocusedIssue, IssueProvider, IssueProviderResult } from "../extensions/focused-issue/types.ts";

type Handler = (event: unknown, ctx?: FakeCtx) => unknown;

interface FakeCtx {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify: ReturnType<typeof vi.fn>;
		setWidget: ReturnType<typeof vi.fn>;
	};
	sessionManager: {
		getBranch: () => unknown[];
	};
}

function issue(): FocusedIssue {
	return {
		providerId: "linear",
		id: "issue-id",
		key: "ENG-123",
		title: "Add focused issue extension",
		labels: [],
		pullRequests: [],
	};
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((innerResolve) => {
		resolve = innerResolve;
	});
	return { promise, resolve };
}

function createCtx(entries: unknown[] = [], hasUI = true, cwd = process.cwd()): FakeCtx {
	return {
		cwd,
		hasUI,
		ui: {
			notify: vi.fn(),
			setWidget: vi.fn(),
		},
		sessionManager: {
			getBranch: () => entries,
		},
	};
}

function createProjectWithFocusedIssueConfig(config: Record<string, unknown>): string {
	const cwd = mkdtempSync(join(tmpdir(), "focused-issue-"));
	const configDir = join(cwd, ".pi", "extensions");
	mkdirSync(configDir, { recursive: true });
	writeFileSync(join(configDir, "focused-issue.json"), `${JSON.stringify(config)}\n`);
	return cwd;
}

function loadExtension(provider: IssueProvider): {
	commands: Map<string, { handler: (args: string, ctx: FakeCtx) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown[] }>;
	handlers: Map<string, Handler>;
	shortcuts: Map<string, { handler: (ctx: FakeCtx) => void }>;
	pi: { appendEntry: ReturnType<typeof vi.fn> };
} {
	const commands = new Map<string, { handler: (args: string, ctx: FakeCtx) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown[] }>();
	const handlers = new Map<string, Handler>();
	const shortcuts = new Map<string, { handler: (ctx: FakeCtx) => void }>();
	const pi = {
		registerCommand: vi.fn((name: string, options: { handler: (args: string, ctx: FakeCtx) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown[] }) => {
			commands.set(name, options);
		}),
		registerShortcut: vi.fn((shortcut: string, options: { handler: (ctx: FakeCtx) => void }) => {
			shortcuts.set(shortcut, options);
		}),
		on: vi.fn((event: string, handler: Handler) => {
			handlers.set(event, handler);
		}),
		appendEntry: vi.fn(),
	};

	createFocusedIssueExtension([provider])(pi as never);
	return { commands, handlers, shortcuts, pi };
}

describe("focused issue extension", () => {
	it("registers focused issue commands and completions", () => {
		const { commands, shortcuts } = loadExtension({
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(),
		});

		expect(commands.has("focus-issue")).toBe(true);
		expect(commands.get("focus-issue")?.getArgumentCompletions?.("re")).toEqual([{ label: "refresh", value: "refresh" }]);
		expect([...shortcuts.keys()].sort()).toEqual(["ctrl+shift+down", "ctrl+shift+up", "ctrl+shift+w"]);
	});

	it("sets focus without awaiting provider fetch and renders the widget", async () => {
		const pending = deferred<IssueProviderResult>();
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(() => pending.promise),
		};
		const { commands } = loadExtension(provider);
		const ctx = createCtx();

		await commands.get("focus-issue")?.handler("ENG-123", ctx);

		expect(provider.fetchIssue).toHaveBeenCalledTimes(1);
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("focused-issue", expect.any(Function), { placement: "aboveEditor" });
	});

	it("clears, refreshes, and shows focus", async () => {
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(() => Promise.resolve({ ok: true, issue: issue() })),
		};
		const { commands } = loadExtension(provider);
		const ctx = createCtx([], true, createProjectWithFocusedIssueConfig({ autoFocusIssueMentions: true }));
		const command = commands.get("focus-issue");

		await command?.handler("ENG-123", ctx);
		await command?.handler("refresh", ctx);
		await command?.handler("show", ctx);
		await command?.handler("clear", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Focused issue refresh started", "info");
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("ENG-123"), "info");
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("focused-issue", undefined, { placement: "aboveEditor" });
	});

	it("injects pending context once and ready context once", async () => {
		const pending = deferred<IssueProviderResult>();
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(() => pending.promise),
		};
		const { commands, handlers } = loadExtension(provider);
		const ctx = createCtx();

		await commands.get("focus-issue")?.handler("ENG-123", ctx);
		const first = handlers.get("before_agent_start")?.({}, ctx) as { message?: { content: string } } | undefined;
		const second = handlers.get("before_agent_start")?.({}, ctx) as { message?: { content: string } } | undefined;
		pending.resolve({ ok: true, issue: issue() });
		await pending.promise;
		await Promise.resolve();
		const third = handlers.get("before_agent_start")?.({}, ctx) as { message?: { content: string } } | undefined;
		const fourth = handlers.get("before_agent_start")?.({}, ctx) as { message?: { content: string } } | undefined;

		expect(first?.message?.content).toContain("metadata is still loading asynchronously");
		expect(second).toBeUndefined();
		expect(third?.message?.content).toContain("Title: Add focused issue extension");
		expect(fourth).toBeUndefined();
	});

	it("restores state on session start and cancels on shutdown", async () => {
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(() => Promise.resolve({ ok: true, issue: issue() })),
		};
		const snapshot = {
			status: "ready" as const,
			reference: "ENG-123",
			providerId: "linear",
			issue: issue(),
			error: null,
			version: 1,
			lastInjectedVersion: 0,
			pendingInjectedVersion: 0,
			fetchedAt: 1000,
		};
		const { handlers } = loadExtension(provider);
		const ctx = createCtx([{ type: "custom", customType: "focused-issue-state", data: snapshot }]);

		handlers.get("session_start")?.({}, ctx);
		handlers.get("session_shutdown")?.({}, ctx);

		expect(ctx.ui.setWidget).toHaveBeenCalledWith("focused-issue", expect.any(Function), { placement: "aboveEditor" });
	});

	it("keeps command behavior without interactive widget rendering", async () => {
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(() => Promise.resolve({ ok: true, issue: issue() })),
		};
		const { commands } = loadExtension(provider);
		const ctx = createCtx([], false);

		await commands.get("focus-issue")?.handler("ENG-123", ctx);

		expect(ctx.ui.setWidget).not.toHaveBeenCalled();
		expect(provider.fetchIssue).toHaveBeenCalledTimes(1);
	});

	it("automatically focuses an issue mentioned in user input", async () => {
		const pending = deferred<IssueProviderResult>();
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: (reference) => reference === "ENG-123",
			extractReference: (text) => (text.includes("ENG-123") ? "ENG-123" : null),
			fetchIssue: vi.fn(() => pending.promise),
		};
		const { handlers } = loadExtension(provider);
		const ctx = createCtx();

		const result = handlers.get("input")?.({ type: "input", text: "please look at ENG-123", source: "interactive" }, ctx);

		expect(result).toEqual({ action: "continue" });
		expect(provider.fetchIssue).toHaveBeenCalledWith("ENG-123", expect.any(AbortSignal));
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("focused-issue", expect.any(Function), { placement: "aboveEditor" });
	});

	it("scrolls the focused issue widget with registered shortcuts", async () => {
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(() => Promise.resolve({ ok: true, issue: issue() })),
		};
		const { commands, shortcuts } = loadExtension(provider);
		const ctx = createCtx();

		await commands.get("focus-issue")?.handler("ENG-123", ctx);
		const callsBeforeScroll = ctx.ui.setWidget.mock.calls.length;
		shortcuts.get("ctrl+shift+down")?.handler(ctx);
		const callsAfterScrollDown = ctx.ui.setWidget.mock.calls.length;
		shortcuts.get("ctrl+shift+up")?.handler(ctx);

		expect(callsAfterScrollDown).toBe(callsBeforeScroll + 1);
		expect(ctx.ui.setWidget.mock.calls.length).toBe(callsAfterScrollDown + 1);
	});

	it("closes the focused issue widget with the registered shortcut", async () => {
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(() => Promise.resolve({ ok: true, issue: issue() })),
		};
		const { commands, shortcuts } = loadExtension(provider);
		const ctx = createCtx();

		await commands.get("focus-issue")?.handler("ENG-123", ctx);
		shortcuts.get("ctrl+shift+w")?.handler(ctx);

		expect(ctx.ui.setWidget).toHaveBeenCalledWith("focused-issue", undefined, { placement: "aboveEditor" });
	});

	it("does not auto-focus issue mentions when extension config disables it", async () => {
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: (reference) => reference === "ENG-123",
			extractReference: (text) => (text.includes("ENG-123") ? "ENG-123" : null),
			fetchIssue: vi.fn(() => Promise.resolve({ ok: true, issue: issue() })),
		};
		const { handlers } = loadExtension(provider);
		const ctx = createCtx([], true, createProjectWithFocusedIssueConfig({ autoFocusIssueMentions: false }));

		const result = handlers.get("input")?.({ type: "input", text: "please look at ENG-123", source: "interactive" }, ctx);

		expect(result).toEqual({ action: "continue" });
		expect(provider.fetchIssue).not.toHaveBeenCalled();
		expect(ctx.ui.setWidget).not.toHaveBeenCalled();
	});
});
