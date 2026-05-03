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
	};
	return { pi, commands };
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
			await options?.withSession?.({
				sendUserMessage: vi.fn(async () => {}),
				waitForIdle: vi.fn(async () => {}),
				sessionManager: {
					getBranch: () => [
						{
							id: "root",
							type: "message",
							message: { role: "user", content: [{ type: "text", text: "start" }] },
						},
						{
							id: "assistant",
							type: "message",
							message: {
								role: "assistant",
								stopReason: "stop",
								content: [
									{
										type: "text",
										text: '```review-findings\n{"summary":"none","findings":[]}\n```',
									},
								],
							},
						},
					],
				},
			});
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
});
