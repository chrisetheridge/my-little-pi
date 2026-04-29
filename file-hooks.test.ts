import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

type Handler = (event: any, ctx: any) => Promise<void> | void;

interface LoadedExtension {
	handlers: Map<string, Handler>;
	pi: {
		exec: ReturnType<typeof vi.fn>;
	};
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

function makeWorkspace(): { homeDir: string; cwd: string } {
	const base = mkdtempSync(join(tmpdir(), "file-hooks-extension-"));
	const homeDir = join(base, "home");
	const cwd = join(base, "project");
	mkdirSync(join(homeDir, ".pi", "agent", "extensions"), { recursive: true });
	mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
	return { homeDir, cwd };
}

async function loadExtension(homeDir: string): Promise<LoadedExtension> {
	process.env.HOME = homeDir;

	const handlers = new Map<string, Handler>();
	const pi = {
		on: vi.fn((event: string, handler: Handler) => {
			handlers.set(event, handler);
		}),
		exec: vi.fn().mockResolvedValue({
			stdout: "",
			stderr: "",
			code: 0,
			killed: false,
		}),
	};

	const { default: fileHooksExtension } = await import("./extensions/file-hooks/index.ts");
	fileHooksExtension(pi as never);

	return { handlers, pi };
}

function createCtx(cwd: string) {
	return {
		cwd,
		hasUI: true,
		signal: undefined,
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
		},
	};
}

function toolResult(toolName: "write" | "edit", path: string, isError = false) {
	return {
		type: "tool_result",
		toolName,
		input: toolName === "write" ? { path, content: "(println :ok)" } : { path, edits: [{ oldText: "old", newText: "new" }] },
		content: [{ type: "text", text: "ok" }],
		details: toolName === "write" ? undefined : { diff: "-old\n+new" },
		isError,
	};
}

describe("file-hooks extension", () => {
	it("registers a tool_result handler", async () => {
		const { homeDir } = makeWorkspace();
		const { handlers } = await loadExtension(homeDir);

		expect(handlers.has("tool_result")).toBe(true);
	});

	it("runs configured commands for matching file writes", async () => {
		const { homeDir, cwd } = makeWorkspace();
		writeFileSync(
			join(cwd, ".pi", "extensions", "file-hooks.json"),
			JSON.stringify({
				hooks: [
					{
						name: "cljfmt",
						match: ["**/*.clj", "**/*.cljc", "**/*.cljs"],
						command: "bb",
						args: ["cljfmt-fix", "{path}"],
					},
				],
			}),
			"utf-8",
		);

		const { handlers, pi } = await loadExtension(homeDir);
		const ctx = createCtx(cwd);
		const toolResultHandler = handlers.get("tool_result");

		await toolResultHandler?.(toolResult("write", "src/core.clj"), ctx);
		await toolResultHandler?.(toolResult("edit", "src/ui.cljc"), ctx);
		await toolResultHandler?.(toolResult("write", "src/app.cljs"), ctx);

		expect(pi.exec).toHaveBeenCalledTimes(3);
		expect(pi.exec).toHaveBeenNthCalledWith(1, "bb", ["cljfmt-fix", "src/core.clj"], { cwd, signal: undefined });
		expect(pi.exec).toHaveBeenNthCalledWith(2, "bb", ["cljfmt-fix", "src/ui.cljc"], { cwd, signal: undefined });
		expect(pi.exec).toHaveBeenNthCalledWith(3, "bb", ["cljfmt-fix", "src/app.cljs"], { cwd, signal: undefined });
		expect(ctx.ui.notify).toHaveBeenCalledWith("hook cljfmt: src/core.clj", "info");
		expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("file-hooks", undefined);
	});

	it("supports absolute paths and template variables", async () => {
		const { homeDir, cwd } = makeWorkspace();
		writeFileSync(
			join(cwd, ".pi", "extensions", "file-hooks.json"),
			JSON.stringify({
				hooks: [
					{
						name: "fmt",
						match: "**/*.clj",
						command: "echo",
						args: ["{absolutePath}", "{absoluteDir}", "{cwd}"],
					},
				],
			}),
			"utf-8",
		);

		const { handlers, pi } = await loadExtension(homeDir);
		const ctx = createCtx(cwd);
		const toolResultHandler = handlers.get("tool_result");
		const absolute = join(cwd, "src", "core.clj");

		await toolResultHandler?.(toolResult("write", absolute), ctx);

		expect(pi.exec).toHaveBeenCalledWith(
			"echo",
			[absolute, join(cwd, "src"), cwd],
			{ cwd, signal: undefined },
		);
	});

	it("ignores non-matching files and failed tool results", async () => {
		const { homeDir, cwd } = makeWorkspace();
		writeFileSync(
			join(cwd, ".pi", "extensions", "file-hooks.json"),
			JSON.stringify({
				hooks: [
					{
						match: "**/*.clj",
						command: "bb",
						args: ["cljfmt-fix", "{path}"],
					},
				],
			}),
			"utf-8",
		);

		const { handlers, pi } = await loadExtension(homeDir);
		const ctx = createCtx(cwd);
		const toolResultHandler = handlers.get("tool_result");

		await toolResultHandler?.(toolResult("write", "README.md"), ctx);
		await toolResultHandler?.(toolResult("write", "src/core.clj", true), ctx);

		expect(pi.exec).not.toHaveBeenCalled();
	});

	it("can target custom tools that report a path in their result", async () => {
		const { homeDir, cwd } = makeWorkspace();
		writeFileSync(
			join(cwd, ".pi", "extensions", "file-hooks.json"),
			JSON.stringify({
				hooks: [
					{
						name: "custom-save",
						tools: ["save-file"],
						match: "**/*.clj",
						command: "bb",
						args: ["cljfmt-fix", "{path}"],
					},
				],
			}),
			"utf-8",
		);

		const { handlers, pi } = await loadExtension(homeDir);
		const ctx = createCtx(cwd);
		const toolResultHandler = handlers.get("tool_result");

		await toolResultHandler?.(
			{
				type: "tool_result",
				toolName: "save-file",
				input: { path: "src/core.clj" },
				content: [{ type: "text", text: "saved" }],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		expect(pi.exec).toHaveBeenCalledWith("bb", ["cljfmt-fix", "src/core.clj"], { cwd, signal: undefined });
	});

	it("notifies on formatter failure", async () => {
		const { homeDir, cwd } = makeWorkspace();
		writeFileSync(
			join(cwd, ".pi", "extensions", "file-hooks.json"),
			JSON.stringify({
				hooks: [
					{
						name: "cljfmt",
						match: "**/*.clj",
						command: "bb",
						args: ["cljfmt-fix", "{path}"],
					},
				],
			}),
			"utf-8",
		);

		const { handlers, pi } = await loadExtension(homeDir);
		pi.exec.mockResolvedValue({
			stdout: "",
			stderr: "boom",
			code: 1,
			killed: false,
		});
		const ctx = createCtx(cwd);
		const toolResultHandler = handlers.get("tool_result");

		await toolResultHandler?.(toolResult("write", "src/core.clj"), ctx);

		expect(ctx.ui.notify).toHaveBeenNthCalledWith(1, "hook cljfmt: src/core.clj", "info");
		expect(ctx.ui.notify).toHaveBeenNthCalledWith(2, "cljfmt failed for src/core.clj", "warning");
	});
});
