import { describe, expect, it, vi, afterEach } from "vitest";

import answerExtension, { extractQuestionsFromText, getLastAssistantText } from "./extensions/answer/index";

afterEach(() => {
	vi.restoreAllMocks();
});

function makePi() {
	const commands = new Map<string, any>();
	const shortcuts = new Map<string, any>();
	const pi = {
		registerCommand: vi.fn((name: string, options: any) => {
			commands.set(name, options);
		}),
		registerShortcut: vi.fn((shortcut: string, options: any) => {
			shortcuts.set(shortcut, options);
		}),
		sendMessage: vi.fn(async () => {}),
	};
	return { pi, commands, shortcuts };
}

function makeCtx(entries: Array<any> = [], answers: Array<string | undefined> = []) {
	const editor = vi.fn(async () => answers.shift());
	const notify = vi.fn();
	return {
		cwd: "/tmp/project",
		hasUI: true,
		ui: {
			notify,
			editor,
		},
		sessionManager: {
			getEntries: () => entries,
		},
	};
}

describe("answer extension", () => {
	it("extracts question sentences from assistant text", () => {
		const questions = extractQuestionsFromText(
			"We should decide on the database. What do you want to use?\n" +
			"- Should I keep the current architecture?\n" +
			"```ts\n" +
			"const x = what?;\n" +
			"```\n",
		);

		expect(questions.map((q) => q.question)).toEqual([
			"What do you want to use?",
			"Should I keep the current architecture?",
		]);
	});

	it("finds the last assistant text from session entries", () => {
		const entries = [
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }] } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "First." }] } },
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "Last?" }] } },
		];

		expect(getLastAssistantText(entries)).toBe("Last?");
	});

	it("collects answers and sends a follow-up turn", async () => {
		const { pi, commands } = makePi();
		answerExtension(pi as never);
		const handler = commands.get("answer")?.handler as ((args: string, ctx: any) => Promise<void>) | undefined;
		expect(handler).toBeTypeOf("function");

		const ctx = makeCtx([
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "What database should we use? Also, should I add tests?" }] } },
		], ["SQLite", "Yes, add tests"]);

		await handler!("", ctx);

		expect(ctx.ui.editor).toHaveBeenCalledTimes(2);
		expect(ctx.ui.notify).toHaveBeenCalledWith("Found 2 questions.", "info");
		expect(pi.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({
				customType: "answer",
				display: true,
				content: expect.stringContaining("Q: What database should we use?"),
			}),
			expect.objectContaining({ triggerTurn: true }),
		);
	});

	it("stops cleanly when the user cancels", async () => {
		const { pi, commands } = makePi();
		answerExtension(pi as never);
		const handler = commands.get("answer")?.handler as ((args: string, ctx: any) => Promise<void>) | undefined;
		expect(handler).toBeTypeOf("function");

		const ctx = makeCtx([
			{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "What should we do next?" }] } },
		], [undefined]);

		await handler!("", ctx);

		expect(pi.sendMessage).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith("Cancelled.", "info");
	});

	it("warns when there is nothing to answer", async () => {
		const { pi, commands } = makePi();
		answerExtension(pi as never);
		const handler = commands.get("answer")?.handler as ((args: string, ctx: any) => Promise<void>) | undefined;
		expect(handler).toBeTypeOf("function");

		const ctx = makeCtx([{ type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } }]);

		await handler!("", ctx);

		expect(pi.sendMessage).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith("No assistant message found to answer.", "warning");
	});
});
