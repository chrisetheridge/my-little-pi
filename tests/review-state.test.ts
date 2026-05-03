import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "../extensions/review/findings.ts";
import type { ReviewTarget } from "../extensions/review/git.ts";
import { buildInitialReviewState, discardFinding, updateFindingNote, updateFindingStatus, updateReviewIndex } from "../extensions/review/state.ts";

const target: ReviewTarget = {
	mode: "uncommitted",
	label: "Uncommitted changes",
	promptContext: "diff",
	changedFiles: ["src/a.ts"],
	stagedCount: 1,
	unstagedCount: 0,
};

const findings: ReviewFinding[] = [
	{
		id: "finding-a",
		severity: "high",
		file: "src/a.ts",
		startLine: 1,
		title: "A",
		explanation: "Risk A.",
		suggestedFix: "Fix A.",
		status: "open",
	},
	{
		id: "finding-b",
		severity: "low",
		file: "src/b.ts",
		startLine: 2,
		title: "B",
		explanation: "Risk B.",
		suggestedFix: "Fix B.",
		status: "open",
	},
];

describe("review state", () => {
	it("creates initial state without persisting prompt context", () => {
		const state = buildInitialReviewState(target, findings, "raw output");

		expect(state.kind).toBe("review-state");
		expect(state.findings).toEqual(findings);
		expect(state.currentIndex).toBe(0);
		expect(state.rawReviewOutput).toBe("raw output");
		expect(state.target).toEqual({
			mode: "uncommitted",
			label: "Uncommitted changes",
			changedFiles: ["src/a.ts"],
			stagedCount: 1,
			unstagedCount: 0,
		});
		expect("promptContext" in state.target).toBe(false);
	});

	it("updates finding status immutably", () => {
		const state = buildInitialReviewState(target, findings, "raw output");
		const updated = updateFindingStatus(state, "finding-a", "ignored");

		expect(updated).not.toBe(state);
		expect(updated.findings).not.toBe(state.findings);
		expect(updated.findings[0]?.status).toBe("ignored");
		expect(state.findings[0]?.status).toBe("open");
		expect(updated.findings[1]).toBe(state.findings[1]);
	});

	it("updates finding notes immutably", () => {
		const state = buildInitialReviewState(target, findings, "raw output");
		const updated = updateFindingNote(state, "finding-a", "Do it this way.");

		expect(updated).not.toBe(state);
		expect(updated.findings).not.toBe(state.findings);
		expect(updated.findings[0]?.note).toBe("Do it this way.");
		expect(state.findings[0]?.note).toBeUndefined();
		expect(updated.findings[1]).toBe(state.findings[1]);
	});

	it("discards findings immutably", () => {
		const state = buildInitialReviewState(target, findings, "raw output");
		const updated = discardFinding(state, "finding-a");

		expect(updated.findings).toHaveLength(1);
		expect(updated.findings[0]?.id).toBe("finding-b");
		expect(updated.currentIndex).toBe(0);
		expect(state.findings).toHaveLength(2);
	});

	it("clamps review index and updates immutably", () => {
		const state = buildInitialReviewState(target, findings, "raw output");

		const moved = updateReviewIndex(state, 1);
		expect(moved).not.toBe(state);
		expect(moved.currentIndex).toBe(1);
		expect(state.currentIndex).toBe(0);

		expect(updateReviewIndex(state, -10).currentIndex).toBe(0);
		expect(updateReviewIndex(state, 99).currentIndex).toBe(1);
	});
});
