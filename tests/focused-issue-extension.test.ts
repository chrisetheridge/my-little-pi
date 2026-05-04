import { describe, expect, it, vi } from "vitest";

import { createFocusedIssueExtension } from "../extensions/focused-issue/index.ts";
import type { FocusedIssue, IssueProvider, IssueProviderResult } from "../extensions/focused-issue/types.ts";

type Handler = (event: unknown, ctx?: FakeCtx) => unknown;

interface FakeCtx {
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

function createCtx(entries: unknown[] = [], hasUI = true): FakeCtx {
	return {
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

function loadExtension(provider: IssueProvider): {
	commands: Map<string, { handler: (args: string, ctx: FakeCtx) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown[] }>;
	handlers: Map<string, Handler>;
	pi: { appendEntry: ReturnType<typeof vi.fn> };
} {
	const commands = new Map<string, { handler: (args: string, ctx: FakeCtx) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown[] }>();
	const handlers = new Map<string, Handler>();
	const pi = {
		registerCommand: vi.fn((name: string, options: { handler: (args: string, ctx: FakeCtx) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown[] }) => {
			commands.set(name, options);
		}),
		on: vi.fn((event: string, handler: Handler) => {
			handlers.set(event, handler);
		}),
		appendEntry: vi.fn(),
	};

	createFocusedIssueExtension([provider])(pi as never);
	return { commands, handlers, pi };
}

describe("focused issue extension", () => {
	it("registers focused issue commands and completions", () => {
		const { commands } = loadExtension({
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(),
		});

		expect(commands.has("focus-issue")).toBe(true);
		expect(commands.has("set-focused-issue")).toBe(true);
		expect(commands.get("focus-issue")?.getArgumentCompletions?.("re")).toEqual([{ label: "refresh", value: "refresh" }]);
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
		expect(ctx.ui.notify).toHaveBeenCalledWith("focused issue set: ENG-123", "info");
	});

	it("supports the set-focused-issue alias", async () => {
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(() => Promise.resolve({ ok: true, issue: issue() })),
		};
		const { commands } = loadExtension(provider);
		const ctx = createCtx();

		await commands.get("set-focused-issue")?.handler("ENG-123", ctx);

		expect(provider.fetchIssue).toHaveBeenCalledWith("ENG-123", expect.any(AbortSignal));
	});

	it("clears, refreshes, and shows focus", async () => {
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn(() => Promise.resolve({ ok: true, issue: issue() })),
		};
		const { commands } = loadExtension(provider);
		const ctx = createCtx();
		const command = commands.get("focus-issue");

		await command?.handler("ENG-123", ctx);
		await command?.handler("refresh", ctx);
		await command?.handler("show", ctx);
		await command?.handler("clear", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("focused issue refresh started", "info");
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
});
