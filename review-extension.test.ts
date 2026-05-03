import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.restoreAllMocks();
	vi.doUnmock("@mariozechner/pi-ai");
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
		modelRegistry: {
			getApiKeyAndHeaders: vi.fn(async () => ({ ok: true, apiKey: "test-key", headers: { "x-test": "1" } })),
		},
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

	it("opens recovery UI for malformed assistant output and cancel does not show findings", async () => {
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");
		reviewExtension(pi as never);

		const replacementCtx = makeReviewCtx("not json");
		replacementCtx.ui.select = vi.fn(async () => "Cancel");
		const ctx = makeCommandCtx({
			cwd: makeRepo(),
			fork: vi.fn(async (_entryId: string, options: any) => {
				await options?.withSession?.(replacementCtx);
				return { cancelled: false };
			}),
		});

		await commands.get("review").handler("", ctx);

		expect(replacementCtx.ui.select).toHaveBeenCalledWith(
			expect.stringContaining("Review findings parse failed."),
			["Retry extraction", "Cancel"],
		);
		expect(replacementCtx.ui.select.mock.calls[0]?.[0]).toContain("Missing ```review-findings fenced block.");
		expect(replacementCtx.ui.select.mock.calls[0]?.[0]).toContain("not json");
		expect(replacementCtx.ui.notify).toHaveBeenCalledWith("Review cancelled.", "info");
		expect(replacementCtx.sendMessage).not.toHaveBeenCalled();
		expect(ctx.ui.custom).not.toHaveBeenCalled();
		expect(replacementCtx.ui.custom).not.toHaveBeenCalled();
	});

	it("retries malformed assistant output through formatter and then opens findings", async () => {
		const formatterOutput = [
			"```review-findings",
			JSON.stringify({
				summary: "Recovered.",
				findings: [
					{
						severity: "medium",
						file: "README.md",
						startLine: 2,
						title: "Recovered issue",
						explanation: "The formatter preserved an actionable finding.",
						suggestedFix: "Fix the recovered issue.",
					},
				],
			}),
			"```",
		].join("\n");
		const complete = vi.fn(async () => ({
			role: "assistant",
			content: [{ type: "text", text: formatterOutput }],
			api: "test",
			provider: "test",
			model: "test/model",
			usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
			stopReason: "stop",
			timestamp: Date.now(),
		}));
		vi.doMock("@mariozechner/pi-ai", async () => ({
			...(await vi.importActual("@mariozechner/pi-ai")),
			complete,
		}));

		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");
		reviewExtension(pi as never);

		const replacementCtx = makeReviewCtx("plain markdown with a real issue");
		replacementCtx.ui.select = vi.fn(async () => "Retry extraction");
		replacementCtx.ui.custom = vi.fn(async () => undefined);
		const ctx = makeCommandCtx({
			cwd: makeRepo(),
			fork: vi.fn(async (_entryId: string, options: any) => {
				await options?.withSession?.(replacementCtx);
				return { cancelled: false };
			}),
		});

		await commands.get("review").handler("", ctx);

		expect(replacementCtx.modelRegistry.getApiKeyAndHeaders).toHaveBeenCalledWith(replacementCtx.model);
		expect(complete).toHaveBeenCalledWith(
			replacementCtx.model,
			{
				messages: [
					expect.objectContaining({
						role: "user",
						content: [expect.objectContaining({
							type: "text",
							text: expect.stringContaining("exactly one fenced review-findings block and no prose"),
						})],
					}),
				],
			},
			{ apiKey: "test-key", headers: { "x-test": "1" } },
		);
		expect(replacementCtx.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
			customType: "review-state",
			details: expect.objectContaining({
				kind: "review-state",
				rawReviewOutput: "plain markdown with a real issue",
				findings: [expect.objectContaining({ title: "Recovered issue" })],
			}),
		}));
		expect(replacementCtx.ui.custom).toHaveBeenCalled();
	});

	it("shows actions as unavailable in the findings dialog", async () => {
		const { FindingsDialog } = await import("./extensions/review/ui.ts");
		const { buildInitialReviewState } = await import("./extensions/review/state.ts");
		const state = buildInitialReviewState({
			mode: "uncommitted",
			label: "Uncommitted changes",
			promptContext: "diff",
			changedFiles: ["README.md"],
			stagedCount: 0,
			unstagedCount: 1,
		}, [
			{
				id: "finding-a",
				severity: "low",
				file: "README.md",
				startLine: 1,
				title: "Test finding",
				explanation: "Explanation.",
				suggestedFix: "Fix.",
				status: "open",
			},
		], "raw");
			const dialog = new FindingsDialog(
				state,
				makeRepo(),
				{ fg: (role: string, text: string) => role === "dim" ? `<dim>${text}</dim>` : text } as never,
				vi.fn(),
				async () => true,
				async () => undefined,
			);

		expect(dialog.render(100).join("\n")).toContain("a: actions unavailable");

		dialog.handleInput("a");

		expect(dialog.render(100).join("\n")).toContain("<dim>Actions are not designed yet.</dim>");
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
