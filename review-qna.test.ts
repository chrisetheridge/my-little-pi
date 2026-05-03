import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "./extensions/review/findings.ts";
import type { ReviewTarget } from "./extensions/review/git.ts";
import { buildQnaPrompt } from "./extensions/review/prompt.ts";
import { addQnaTurn, buildInitialReviewState } from "./extensions/review/state.ts";

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
});
