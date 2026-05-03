import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ReviewFinding } from "./extensions/review/findings.ts";
import type { ReviewTarget } from "./extensions/review/git.ts";
import { buildQnaPrompt } from "./extensions/review/prompt.ts";
import { addQnaTurn, buildInitialReviewState } from "./extensions/review/state.ts";
import { FindingsDialog, qnaAnswerFromResponse } from "./extensions/review/ui.ts";

const finding: ReviewFinding = {
	id: "finding-a",
	severity: "high",
	file: "src/a.ts",
	startLine: 10,
	endLine: 12,
	title: "Missing bounds check",
	explanation: "The index can exceed the array length.",
	suggestedFix: "Validate the index before reading the array.",
	status: "open",
};

const target: ReviewTarget = {
	mode: "uncommitted",
	label: "Uncommitted changes",
	promptContext: "diff",
	changedFiles: ["src/a.ts"],
	stagedCount: 1,
	unstagedCount: 0,
};

function makeSourceRoot(): string {
	const cwd = mkdtempSync(join(tmpdir(), "review-qna-"));
	mkdirSync(join(cwd, "src"), { recursive: true });
	writeFileSync(join(cwd, "src", "a.ts"), [
		"const one = 1;",
		"const two = 2;",
		"const three = 3;",
		"const four = 4;",
		"const five = 5;",
		"const six = 6;",
		"const seven = 7;",
		"const eight = 8;",
		"const nine = 9;",
		"return items[index];",
		"const eleven = 11;",
		"const twelve = 12;",
	].join("\n"), "utf-8");
	return cwd;
}

describe("review Q&A", () => {
	it("builds a prompt scoped to the selected finding", () => {
		const prompt = buildQnaPrompt({
			finding,
			targetLabel: "Local changes against main",
			sourceExcerpt: "  9: const value = items[index - 1];\n> 10: return items[index];",
			priorTurns: [
				{
					question: "Why is this high severity?",
					answer: "It can crash a common path.",
					timestamp: 100,
				},
			],
			question: "What should the guard look like?",
		});

		expect(prompt).toContain(
			"Answer only about this selected finding. Do not perform a new review and do not create new findings.",
		);
		expect(prompt).toContain("Finding: Missing bounds check");
		expect(prompt).toContain("Location: src/a.ts:10");
		expect(prompt).toContain("Explanation: The index can exceed the array length.");
		expect(prompt).toContain("Suggested fix: Validate the index before reading the array.");
		expect(prompt).toContain("Source excerpt:\n  9: const value = items[index - 1];\n> 10: return items[index];");
		expect(prompt).toContain("Q: Why is this high severity?\nA: It can crash a common path.");
		expect(prompt).toContain("User question: What should the guard look like?");
	});

	it("adds Q&A turns immutably under the selected finding id", () => {
		const state = buildInitialReviewState(target, [finding], "raw output");
		const turn = { question: "Why?", answer: "Because.", timestamp: 10 };

		const updated = addQnaTurn(state, "finding-a", turn);

		expect(updated).not.toBe(state);
		expect(updated.qnaByFindingId).not.toBe(state.qnaByFindingId);
		expect(updated.qnaByFindingId["finding-a"]).toEqual([turn]);
		expect(state.qnaByFindingId["finding-a"]).toBeUndefined();

		const appended = addQnaTurn(updated, "finding-a", { question: "Again?", answer: "Still because.", timestamp: 20 });
		expect(appended.qnaByFindingId["finding-a"]).toEqual([
			turn,
			{ question: "Again?", answer: "Still because.", timestamp: 20 },
		]);
		expect(updated.qnaByFindingId["finding-a"]).toEqual([turn]);
	});

	it("accepts only completed non-empty Q&A responses", () => {
		const response = (
			stopReason: AssistantMessage["stopReason"],
			text: string,
		): Pick<AssistantMessage, "stopReason" | "content" | "errorMessage"> => ({
			stopReason,
			content: text ? [{ type: "text", text }] : [],
			errorMessage: stopReason === "error" ? "provider failed" : undefined,
		});

		expect(qnaAnswerFromResponse(response("stop", " Answer. "))).toEqual({ ok: true, answer: "Answer." });
		expect(qnaAnswerFromResponse(response("length", "Partial."))).toEqual({
			ok: false,
			message: "Could not answer finding question: model stopped with length.",
		});
		expect(qnaAnswerFromResponse(response("error", "Nope."))).toEqual({
			ok: false,
			message: "Could not answer finding question: provider failed",
		});
		expect(qnaAnswerFromResponse(response("stop", ""))).toEqual({
			ok: false,
			message: "Could not answer finding question: empty response.",
		});
	});

	it("aborts an in-flight Q&A request on Escape", async () => {
		const state = buildInitialReviewState(target, [finding], "raw output");
		let signal: AbortSignal | undefined;
		let resolveQuestion: ((value: undefined) => void) | undefined;
		let doneState: unknown;
		const dialog = new FindingsDialog(
			state,
			makeSourceRoot(),
			{ fg: (_role: string, text: string) => text } as never,
			(result) => {
				doneState = result;
			},
			async () => true,
			(_currentState, _findingId, abortSignal) => {
				signal = abortSignal;
				return new Promise((resolve) => {
					resolveQuestion = resolve;
				});
			},
		);

		dialog.handleInput("q");
		expect(signal?.aborted).toBe(false);

		dialog.handleInput("\x1b");
		expect(signal?.aborted).toBe(true);

		resolveQuestion?.(undefined);
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(doneState).toBe(state);
	});

	it("preserves dialog-local mutations when Q&A updates state", async () => {
		const state = buildInitialReviewState(target, [finding], "raw output");
		let doneState: any;
		const dialog = new FindingsDialog(
			state,
			makeSourceRoot(),
			{ fg: (_role: string, text: string) => text } as never,
			(result) => {
				doneState = result;
			},
			async () => true,
			async (currentState, findingId) => addQnaTurn(currentState, findingId, {
				question: "Why?",
				answer: "Because.",
				timestamp: 10,
			}),
		);

		dialog.handleInput("i");
		dialog.handleInput("q");
		await new Promise((resolve) => setTimeout(resolve, 0));
		dialog.handleInput("\x1b");

		expect(doneState.findings[0]?.status).toBe("ignored");
		expect(doneState.qnaByFindingId["finding-a"]).toEqual([
			{ question: "Why?", answer: "Because.", timestamp: 10 },
		]);
	});

	it("renders source excerpts and Q&A content in the finding dialog", () => {
		const state = addQnaTurn(buildInitialReviewState(target, [finding], "raw output"), "finding-a", {
			question: "Why?",
			answer: "Because it can crash.",
			timestamp: 10,
		});
		const dialog = new FindingsDialog(
			state,
			makeSourceRoot(),
			{ fg: (_role: string, text: string) => text } as never,
			() => undefined,
			async () => true,
			async () => undefined,
		);

		const rendered = dialog.render(100).join("\n");

		expect(rendered).toContain("Source:");
		expect(rendered).toContain("return items[index];");
		expect(rendered).toContain("Q: Why?");
		expect(rendered).toContain("A: Because it can crash.");
	});

	it("confirms before closing when findings remain open", async () => {
		const state = buildInitialReviewState(target, [finding], "raw output");
		let confirmCalls = 0;
		let doneState: unknown;
		const dialog = new FindingsDialog(
			state,
			makeSourceRoot(),
			{ fg: (_role: string, text: string) => text } as never,
			(result) => {
				doneState = result;
			},
			async () => {
				confirmCalls += 1;
				return false;
			},
			async () => undefined,
		);

		dialog.handleInput("\x1b");
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(confirmCalls).toBe(1);
		expect(doneState).toBeUndefined();
	});
});
