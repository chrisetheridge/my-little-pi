import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

function makePi() {
	const commands = new Map<string, any>();
	const pi = {
		registerCommand: vi.fn((name: string, options: any) => {
			commands.set(name, options);
		}),
		appendEntry: vi.fn(),
	};
	return { pi, commands };
}

function run(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, stdio: "pipe" });
	if (result.status !== 0) {
		throw new Error(result.stderr.toString() || result.stdout.toString());
	}
}

function makeRepo(): string {
	const cwd = mkdtempSync(join(tmpdir(), "review-extension-"));
	run(cwd, ["init", "-b", "main"]);
	run(cwd, ["config", "user.email", "test@example.com"]);
	run(cwd, ["config", "user.name", "Test User"]);
	writeFileSync(join(cwd, "README.md"), "hello\n", "utf-8");
	run(cwd, ["add", "README.md"]);
	run(cwd, ["commit", "-m", "initial"]);
	writeFileSync(join(cwd, "README.md"), "hello\nreview me\n", "utf-8");
	return cwd;
}

function makeReviewCtx(assistantText = '```review-findings\n{"summary":"none","findings":[]}\n```', overrides: Partial<any> = {}) {
	return {
		...makeCommandCtx({ cwd: "/tmp/replacement-project" }),
		sendUserMessage: vi.fn(async () => {}),
		waitForIdle: vi.fn(async () => {}),
		sessionManager: {
			getBranch: () => [
				{ id: "root", type: "message", message: { role: "user", content: [{ type: "text", text: "start" }] } },
				{
					id: "assistant",
					type: "message",
					message: {
						role: "assistant",
						stopReason: "stop",
						content: [{ type: "text", text: assistantText }],
					},
				},
			],
		},
		...overrides,
	};
}

function makeCommandCtx(overrides: Partial<any> = {}) {
	return {
		cwd: "/tmp/project",
		hasUI: true,
		model: { id: "test/model", provider: "test" },
		ui: {
			notify: vi.fn(),
			select: vi.fn(async () => "Uncommitted changes"),
			confirm: vi.fn(async () => true),
			input: vi.fn(async () => "main"),
			custom: vi.fn(async () => "closed"),
			theme: { fg: (_role: string, text: string) => text },
		},
		sessionManager: {
			getBranch: () => [
				{ id: "root", type: "message", message: { role: "user", content: [{ type: "text", text: "start" }] } },
			],
		},
		fork: vi.fn(async (_entryId: string, options: any) => {
			await options?.withSession?.(makeReviewCtx());
			return { cancelled: false };
		}),
		waitForIdle: vi.fn(async () => {}),
		...overrides,
	};
}

describe("review extension", () => {
	it("registers the review command", async () => {
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");

		reviewExtension(pi as never);

		expect(commands.has("review")).toBe(true);
		expect(commands.get("review")?.description).toContain("code review");
	});

	it("rejects /review without interactive UI", async () => {
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");
		reviewExtension(pi as never);

		const ctx = makeCommandCtx({ hasUI: false });
		await commands.get("review").handler("", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("/review requires interactive mode", "error");
	});

	it("rejects /review without a selected model", async () => {
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");
		reviewExtension(pi as never);

		const ctx = makeCommandCtx({ model: undefined });
		await commands.get("review").handler("", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Select a model before running /review.", "error");
	});

	it("shows findings with the replacement review context after fork", async () => {
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");
		reviewExtension(pi as never);

		const replacementCtx = makeReviewCtx();
		const ctx = makeCommandCtx({
			cwd: makeRepo(),
			fork: vi.fn(async (_entryId: string, options: any) => {
				await options?.withSession?.(replacementCtx);
				return { cancelled: false };
			}),
		});

		await commands.get("review").handler("", ctx);

		expect(ctx.ui.custom).not.toHaveBeenCalled();
		expect(replacementCtx.ui.custom).toHaveBeenCalled();
	});

	it("persists initial and updated review state when a finding is ignored", async () => {
		const assistantText = [
			"```review-findings",
			JSON.stringify({
				summary: "One issue found.",
				findings: [
					{
						severity: "high",
						file: "README.md",
						startLine: 1,
						title: "Risky README",
						explanation: "The README says something risky.",
						suggestedFix: "Make the README safer.",
					},
				],
			}),
			"```",
		].join("\n");
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");
		reviewExtension(pi as never);

		const replacementCtx = makeReviewCtx(assistantText);
		replacementCtx.ui.custom = vi.fn(async (factory: any) => {
			let result;
			const component = factory(null, replacementCtx.ui.theme, null, (updated: any) => {
				result = updated;
			});
			component.handleInput("i");
			component.handleInput("\x1b");
			return result;
		});
		const ctx = makeCommandCtx({
			cwd: makeRepo(),
			fork: vi.fn(async (_entryId: string, options: any) => {
				await options?.withSession?.(replacementCtx);
				return { cancelled: false };
			}),
		});

		await commands.get("review").handler("", ctx);

		expect(pi.appendEntry).toHaveBeenCalledTimes(2);
		expect(pi.appendEntry).toHaveBeenNthCalledWith(
			1,
			"review-state",
			expect.objectContaining({
				kind: "review-state",
				currentIndex: 0,
				findings: [expect.objectContaining({ status: "open" })],
			}),
		);
		expect(pi.appendEntry).toHaveBeenNthCalledWith(
			2,
			"review-state",
			expect.objectContaining({
				kind: "review-state",
				currentIndex: 0,
				findings: [expect.objectContaining({ status: "ignored" })],
			}),
		);
	});

	it("handles cancelled review fork without parsing or showing findings", async () => {
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");
		reviewExtension(pi as never);

		const ctx = makeCommandCtx({
			cwd: makeRepo(),
			fork: vi.fn(async () => ({ cancelled: true })),
		});

		await commands.get("review").handler("", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Review cancelled.", "info");
		expect(ctx.ui.custom).not.toHaveBeenCalled();
	});

	it("notifies when review findings cannot be parsed", async () => {
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");
		reviewExtension(pi as never);

		const replacementCtx = makeReviewCtx("not json");
		const ctx = makeCommandCtx({
			cwd: makeRepo(),
			fork: vi.fn(async (_entryId: string, options: any) => {
				await options?.withSession?.(replacementCtx);
				return { cancelled: false };
			}),
		});

		await commands.get("review").handler("", ctx);

		expect(replacementCtx.ui.notify).toHaveBeenCalledWith("Could not parse review findings.", "error");
		expect(ctx.ui.custom).not.toHaveBeenCalled();
		expect(replacementCtx.ui.custom).not.toHaveBeenCalled();
	});
});
