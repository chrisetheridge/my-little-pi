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
		sendMessage: vi.fn(async () => {}),
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

	it("persists initial and updated review state in the replacement session when a finding is ignored", async () => {
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
		pi.appendEntry.mockImplementation(() => {
			throw new Error("stale appendEntry");
		});
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

		expect(pi.appendEntry).not.toHaveBeenCalled();
		expect(replacementCtx.sendMessage).toHaveBeenCalledTimes(2);
		expect(replacementCtx.sendMessage).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				customType: "review-state",
				content: "",
				display: false,
				details: expect.objectContaining({
					kind: "review-state",
					currentIndex: 0,
					findings: [expect.objectContaining({ status: "open" })],
				}),
			}),
		);
		expect(replacementCtx.sendMessage).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				customType: "review-state",
				content: "",
				display: false,
				details: expect.objectContaining({
					kind: "review-state",
					currentIndex: 0,
					findings: [expect.objectContaining({ status: "ignored" })],
				}),
			}),
		);
		expect(replacementCtx.ui.custom).toHaveBeenCalled();
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

	it("builds PR reviews from a URL and restores the original ref after review", async () => {
		const git = await import("./extensions/review/git.ts");
		vi.spyOn(git, "isGitRepository").mockReturnValue(true);
		vi.spyOn(git, "getCurrentRef").mockReturnValue("main");
		vi.spyOn(git, "buildPullRequestReviewTarget").mockReturnValue({
			mode: "pr",
			label: "Pull request https://github.com/example/project/pull/123",
			promptContext: "PR diff",
			changedFiles: ["README.md"],
			stagedCount: 0,
			unstagedCount: 0,
			prUrl: "https://github.com/example/project/pull/123",
			originalRef: "main",
		});
		const restore = vi.spyOn(git, "restoreOriginalRef").mockReturnValue(true);
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");
		reviewExtension(pi as never);

		const replacementCtx = makeReviewCtx();
		const ctx = makeCommandCtx({
			ui: {
				...makeCommandCtx().ui,
				select: vi.fn(async () => "Pull request URL"),
				input: vi.fn(async () => "https://github.com/example/project/pull/123"),
				confirm: vi.fn(async () => true),
			},
			fork: vi.fn(async (_entryId: string, options: any) => {
				await options?.withSession?.(replacementCtx);
				return { cancelled: false };
			}),
		});

		await commands.get("review").handler("", ctx);

		expect(git.buildPullRequestReviewTarget).toHaveBeenCalledWith(
			ctx.cwd,
			"https://github.com/example/project/pull/123",
			undefined,
			"main",
		);
		expect(restore).toHaveBeenCalledWith(ctx.cwd, "main");
		expect(replacementCtx.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("PR diff"));
	});

	it("notifies when PR review cannot restore after target construction failure", async () => {
		const git = await import("./extensions/review/git.ts");
		vi.spyOn(git, "isGitRepository").mockReturnValue(true);
		vi.spyOn(git, "buildPullRequestReviewTarget").mockImplementation(() => {
			throw new Error("could not read PR diff");
		});
		vi.spyOn(git, "getCurrentRef").mockReturnValue("main");
		const restore = vi.spyOn(git, "restoreOriginalRef").mockReturnValue(false);
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");
		reviewExtension(pi as never);

		const ctx = makeCommandCtx({
			ui: {
				...makeCommandCtx().ui,
				select: vi.fn(async () => "Pull request URL"),
				input: vi.fn(async () => "https://github.com/example/project/pull/123"),
			},
			fork: vi.fn(async () => ({ cancelled: false })),
		});

		await expect(commands.get("review").handler("", ctx)).rejects.toThrow("could not read PR diff");

		expect(git.getCurrentRef).toHaveBeenCalledWith(ctx.cwd);
		expect(restore).toHaveBeenCalledWith(ctx.cwd, "main");
		expect(ctx.ui.notify).toHaveBeenCalledWith("Failed to restore original git ref main.", "error");
		expect(ctx.fork).not.toHaveBeenCalled();
	});
});
