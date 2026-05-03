import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { Text } from "@mariozechner/pi-tui";

type Handler = (event: any, ctx?: any) => any;

interface LoadedExtension {
	commands: Map<string, any>;
	handlers: Map<string, Handler>;
	renderers: Map<string, any>;
	flags: Map<string, any>;
	pi: {
		appendEntry: ReturnType<typeof vi.fn>;
		sendMessage: ReturnType<typeof vi.fn>;
		getFlag: ReturnType<typeof vi.fn>;
	};
}

interface TestCtx {
	cwd: string;
	hasUI: boolean;
	ui: {
		custom: ReturnType<typeof vi.fn>;
		notify: ReturnType<typeof vi.fn>;
		setStatus: ReturnType<typeof vi.fn>;
		theme: {
			fg: (role: string, text: string) => string;
		};
	};
	sessionManager: {
		getEntries: () => Array<any>;
	};
}

const originalEnv = { ...process.env };

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.resetModules();
	for (const key of Object.keys(process.env)) {
		delete process.env[key];
	}
	Object.assign(process.env, originalEnv);
});

function makeProjectRoot(): { homeDir: string; cwd: string } {
	const base = mkdtempSync(join(tmpdir(), "downtime-extension-"));
	const homeDir = join(base, "home");
	const cwd = join(base, "project");
	mkdirSync(join(homeDir, ".pi", "agent", "extensions"), { recursive: true });
	mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
	return { homeDir, cwd };
}

function createCtx(cwd: string, entries: Array<any> = []): TestCtx {
	return {
		cwd,
		hasUI: true,
		ui: {
			custom: vi.fn().mockResolvedValue("escape"),
			notify: vi.fn(),
			setStatus: vi.fn(),
			theme: {
				fg: (_role: string, text: string) => text,
			},
		},
		sessionManager: {
			getEntries: () => entries,
		},
	};
}

async function loadExtension(
	options: {
		cwd: string;
		homeDir: string;
		flag?: string | undefined;
	} = { cwd: process.cwd(), homeDir: process.env.HOME ?? "" },
): Promise<LoadedExtension> {
	process.env.HOME = options.homeDir;

	const commands = new Map<string, any>();
	const handlers = new Map<string, Handler>();
	const renderers = new Map<string, any>();
	const flags = new Map<string, any>();

	const pi = {
		on: vi.fn((event: string, handler: Handler) => {
			handlers.set(event, handler);
		}),
		registerCommand: vi.fn((name: string, options: any) => {
			commands.set(name, options);
		}),
		registerMessageRenderer: vi.fn((type: string, renderer: any) => {
			renderers.set(type, renderer);
		}),
		registerFlag: vi.fn((name: string, options: any) => {
			flags.set(name, options);
		}),
		getFlag: vi.fn((name: string) => {
			if (name === "downtime") return options.flag;
			return undefined;
		}),
		appendEntry: vi.fn(),
		sendMessage: vi.fn(),
	};

	const { default: downtimeExtension } = await import("../extensions/downtime/index.ts");
	downtimeExtension(pi as never);

	return { commands, handlers, renderers, flags, pi };
}

describe("downtime extension", () => {
	it("registers the downtime command, renderer, and configurable flag", async () => {
		const { homeDir, cwd } = makeProjectRoot();
		const { commands, renderers, flags } = await loadExtension({ cwd, homeDir });

		expect(commands.has("downtime")).toBe(true);
		expect(renderers.has("downtime")).toBe(true);
		expect(flags.has("downtime")).toBe(true);
	});

	it("shows the downtime overlay immediately and allows work after acceptance", async () => {
		const { homeDir, cwd } = makeProjectRoot();
		writeFileSync(
			join(cwd, ".pi", "extensions", "downtime.json"),
			JSON.stringify({
				time: "22:00",
				durationMinutes: 480,
				confirmCommand: "echo continue-downtime",
			}),
			"utf-8",
		);
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 3, 28, 22, 30, 0));

		const { handlers, pi } = await loadExtension({ cwd, homeDir });
		const sessionStart = handlers.get("session_start");
		const beforeAgentStart = handlers.get("before_agent_start");
		const toolCall = handlers.get("tool_call");
		const ctx = createCtx(cwd);
		ctx.ui.custom.mockResolvedValue("continue");

		await sessionStart?.({}, ctx);
		expect(ctx.ui.custom).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ overlay: true }));
		expect(pi.appendEntry).toHaveBeenCalledWith(
			"downtime",
			expect.objectContaining({
				confirmedWindowKey: expect.any(String),
			}),
		);

		const initial = await beforeAgentStart?.({ systemPrompt: "base" }, ctx);
		expect(initial?.systemPrompt).toContain("The user has already confirmed continuation");
		expect(initial?.message).toBeUndefined();
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("downtime", expect.any(String));

		const blocked = await toolCall?.(
			{
				toolName: "read",
				input: { path: "README.md" },
			},
			ctx,
		);
		expect(blocked).toBeUndefined();

		const afterConfirm = await toolCall?.(
			{
				toolName: "read",
				input: { path: "README.md" },
			},
			ctx,
		);
		expect(afterConfirm).toBeUndefined();
	});

	it("blocks the pending tool when the downtime overlay is dismissed", async () => {
		const { homeDir, cwd } = makeProjectRoot();
		writeFileSync(
			join(cwd, ".pi", "extensions", "downtime.json"),
			JSON.stringify({
				time: "22:00",
				durationMinutes: 480,
			}),
			"utf-8",
		);
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 3, 28, 22, 30, 0));

		const { handlers, pi } = await loadExtension({ cwd, homeDir });
		const sessionStart = handlers.get("session_start");
		const toolCall = handlers.get("tool_call");
		const ctx = createCtx(cwd);
		ctx.ui.custom.mockResolvedValue("escape");

		await sessionStart?.({}, ctx);

		const result = await toolCall?.(
			{
				toolName: "read",
				input: { path: "README.md" },
			},
			ctx,
		);

		expect(result).toEqual({
			block: true,
			reason: expect.stringContaining("Downtime is active"),
		});
		expect(pi.appendEntry).not.toHaveBeenCalled();
	});

	it("accepts a confirmation typed as chat input before the next tool call", async () => {
		const { homeDir, cwd } = makeProjectRoot();
		writeFileSync(
			join(cwd, ".pi", "extensions", "downtime.json"),
			JSON.stringify({
				time: "22:00",
				durationMinutes: 480,
				confirmCommand: "echo continue-downtime",
			}),
			"utf-8",
		);
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 3, 28, 22, 30, 0));

		const { handlers } = await loadExtension({ cwd, homeDir });
		const sessionStart = handlers.get("session_start");
		const input = handlers.get("input");
		const toolCall = handlers.get("tool_call");
		const ctx = createCtx(cwd);

		await sessionStart?.({}, ctx);
		await input?.(
			{
				text: "echo continue-downtime",
				source: "interactive",
			},
			ctx,
		);

		const result = await toolCall?.(
			{
				toolName: "read",
				input: { path: "README.md" },
			},
			ctx,
		);

		expect(result).toBeUndefined();
		expect(ctx.ui.notify).toHaveBeenCalledWith("Downtime confirmed for this window.", "info");
	});

	it("prepends downtime instructions to the first agent prompt", async () => {
		const { homeDir, cwd } = makeProjectRoot();
		writeFileSync(
			join(cwd, ".pi", "extensions", "downtime.json"),
			JSON.stringify({
				time: "22:00",
				durationMinutes: 480,
				confirmCommand: "echo continue-downtime",
			}),
			"utf-8",
		);
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 3, 28, 22, 30, 0));

		const { handlers } = await loadExtension({ cwd, homeDir });
		const sessionStart = handlers.get("session_start");
		const beforeAgentStart = handlers.get("before_agent_start");
		const ctx = createCtx(cwd);

		await sessionStart?.({}, ctx);

		const result = await beforeAgentStart?.({ systemPrompt: "base" }, ctx);
		expect(result?.systemPrompt).toContain("Downtime is active");
		expect(result?.systemPrompt).toContain("A downtime overlay will ask the user");
		expect(result?.systemPrompt).toContain("Do not answer the user as if downtime is normal");
	});

	it("restores a prior confirmation from the session and renders status details", async () => {
		const { homeDir, cwd } = makeProjectRoot();
		writeFileSync(
			join(cwd, ".pi", "extensions", "downtime.json"),
			JSON.stringify({
				time: "22:00",
				durationMinutes: 480,
			}),
			"utf-8",
		);
		vi.useFakeTimers();
		vi.setSystemTime(new Date(2026, 3, 28, 23, 15, 0));

		const confirmedWindowKey = "2026-04-28@22:00";
		const entries = [
			{
				type: "custom",
				customType: "downtime",
				data: { confirmedWindowKey },
			},
		];
		const { handlers, renderers } = await loadExtension({ cwd, homeDir });
		const sessionStart = handlers.get("session_start");
		const beforeAgentStart = handlers.get("before_agent_start");
		const toolCall = handlers.get("tool_call");
		const renderer = renderers.get("downtime");
		const ctx = createCtx(cwd, entries);

		await sessionStart?.({}, ctx);

		const resumed = await toolCall?.(
			{
				toolName: "read",
				input: { path: "README.md" },
			},
			ctx,
		);
		expect(resumed).toBeUndefined();

		const result = await beforeAgentStart?.({ systemPrompt: "base" }, ctx);
		expect(result?.message?.customType).toBe("downtime");

		const rendered = renderer?.(
			{
				customType: "downtime",
				content: "Downtime active.",
				display: true,
				details: {
					windowLabel: "22:00-06:00",
					active: true,
					confirmed: true,
					confirmCommand: "echo continue-downtime",
					windowKey: confirmedWindowKey,
				},
			},
			{ expanded: true, isPartial: false } as never,
			{
				fg: (_role: string, text: string) => text,
			} as never,
		);

		expect(rendered).toBeInstanceOf(Text);
		expect(rendered?.render(80).join("\n")).toContain("Downtime active");
		expect(rendered?.render(80).join("\n")).toContain("22:00-06:00");
	});
});
