import { describe, expect, it } from "vitest";
import type { ReviewFinding } from "./extensions/review/findings.ts";
import type { ReviewTarget } from "./extensions/review/git.ts";
import {
	REVIEW_STATE_ENTRY_TYPE,
	buildInitialReviewState,
	rebuildLatestReviewState,
	updateFindingStatus,
	updateReviewIndex,
} from "./extensions/review/state.ts";

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

	it("clamps review index and updates immutably", () => {
		const state = buildInitialReviewState(target, findings, "raw output");

		const moved = updateReviewIndex(state, 1);
		expect(moved).not.toBe(state);
		expect(moved.currentIndex).toBe(1);
		expect(state.currentIndex).toBe(0);

		expect(updateReviewIndex(state, -10).currentIndex).toBe(0);
		expect(updateReviewIndex(state, 99).currentIndex).toBe(1);
	});

	it("rebuilds the latest persisted review state from custom entries", () => {
		const older = buildInitialReviewState(target, findings, "older");
		const latest = updateFindingStatus(buildInitialReviewState(target, findings, "latest"), "finding-a", "ignored");

		expect(rebuildLatestReviewState([
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: older },
			{ type: "custom", customType: "other", data: latest },
			{ type: "message", message: { role: "assistant" } },
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: { kind: "other" } },
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: latest },
		])).toBe(latest);
	});

	it("rebuilds the latest persisted review state from custom messages", () => {
		const older = buildInitialReviewState(target, findings, "older");
		const latest = updateFindingStatus(buildInitialReviewState(target, findings, "latest"), "finding-a", "ignored");

		expect(rebuildLatestReviewState([
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: older },
			{
				type: "message",
				message: {
					role: "custom",
					customType: REVIEW_STATE_ENTRY_TYPE,
					content: "",
					display: false,
					details: latest,
				},
			},
		])).toBe(latest);
	});

	it("skips malformed newer review state entries when rebuilding", () => {
		const older = buildInitialReviewState(target, findings, "older");

		expect(rebuildLatestReviewState([
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: older },
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: { kind: "review-state" } },
		])).toBe(older);
	});

	it("skips newer review state entries with malformed findings", () => {
		const older = buildInitialReviewState(target, findings, "older");
		const malformed = {
			...buildInitialReviewState(target, findings, "newer"),
			findings: [{}],
		};

		expect(rebuildLatestReviewState([
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: older },
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: malformed },
		])).toBe(older);
	});

	it("skips newer review state entries with malformed qna turns", () => {
		const older = buildInitialReviewState(target, findings, "older");
		const malformed = {
			...buildInitialReviewState(target, findings, "newer"),
			qnaByFindingId: {
				"finding-a": [{ question: "Why?", answer: "Because.", timestamp: "now" }],
			},
		};

		expect(rebuildLatestReviewState([
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: older },
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: malformed },
		])).toBe(older);
	});

	it("skips newer review state entries with out-of-range current index", () => {
		const older = buildInitialReviewState(target, findings, "older");
		const malformed = {
			...buildInitialReviewState(target, findings, "newer"),
			currentIndex: findings.length,
		};

		expect(rebuildLatestReviewState([
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: older },
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: malformed },
		])).toBe(older);
	});
});
