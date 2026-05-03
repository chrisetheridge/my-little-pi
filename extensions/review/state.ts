import type { FindingStatus, ReviewFinding } from "./findings.ts";
import type { ReviewTarget } from "./git.ts";

export const REVIEW_STATE_ENTRY_TYPE = "review-state";

export interface ReviewQnaTurn {
	question: string;
	answer: string;
	timestamp: number;
}

export interface ReviewRunState {
	kind: "review-state";
	runId: string;
	createdAt: number;
	target: Omit<ReviewTarget, "promptContext">;
	rawReviewOutput: string;
	findings: ReviewFinding[];
	currentIndex: number;
	qnaByFindingId: Record<string, ReviewQnaTurn[]>;
}

export function buildInitialReviewState(
	target: ReviewTarget,
	findings: ReviewFinding[],
	rawReviewOutput: string,
): ReviewRunState {
	const { promptContext: _promptContext, ...persistedTarget } = target;
	const createdAt = Date.now();
	return {
		kind: "review-state",
		runId: `review-${createdAt}-${Math.random().toString(16).slice(2, 8)}`,
		createdAt,
		target: persistedTarget,
		rawReviewOutput,
		findings,
		currentIndex: 0,
		qnaByFindingId: {},
	};
}

export function updateFindingStatus(
	state: ReviewRunState,
	findingId: string,
	status: FindingStatus,
): ReviewRunState {
	return {
		...state,
		findings: state.findings.map((finding) => {
			if (finding.id !== findingId) return finding;
			return { ...finding, status };
		}),
	};
}

export function updateReviewIndex(state: ReviewRunState, index: number): ReviewRunState {
	const maxIndex = Math.max(0, state.findings.length - 1);
	return {
		...state,
		currentIndex: Math.max(0, Math.min(maxIndex, index)),
	};
}

export function rebuildLatestReviewState(entries: Array<any>): ReviewRunState | undefined {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i];
		if (
			entry?.type === "custom" &&
			entry.customType === REVIEW_STATE_ENTRY_TYPE &&
			entry.data?.kind === "review-state"
		) {
			return entry.data as ReviewRunState;
		}
	}
	return undefined;
}
