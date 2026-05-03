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

export function addQnaTurn(state: ReviewRunState, findingId: string, turn: ReviewQnaTurn): ReviewRunState {
	return {
		...state,
		qnaByFindingId: {
			...state.qnaByFindingId,
			[findingId]: [...(state.qnaByFindingId[findingId] ?? []), turn],
		},
	};
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "";
}

function isFiniteInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isOptionalPositiveInteger(value: unknown): boolean {
	return value === undefined || (isFiniteInteger(value) && value >= 1);
}

function isPersistedReviewTarget(value: unknown): value is ReviewRunState["target"] {
	if (!isObject(value)) return false;
	if (!isNonEmptyString(value.mode)) return false;
	if (!isNonEmptyString(value.label)) return false;
	if (!isStringArray(value.changedFiles)) return false;
	if (typeof value.stagedCount !== "number" || !Number.isFinite(value.stagedCount)) return false;
	if (typeof value.unstagedCount !== "number" || !Number.isFinite(value.unstagedCount)) return false;

	for (const field of ["baseRef", "mergeBase", "commitRef", "prUrl", "originalRef"] as const) {
		if (!isOptionalString(value[field])) return false;
	}
	return true;
}

function isPersistedReviewFinding(value: unknown): value is ReviewFinding {
	if (!isObject(value)) return false;
	if (!isNonEmptyString(value.id)) return false;
	if (!["critical", "high", "medium", "low"].includes(value.severity as string)) return false;
	if (!isNonEmptyString(value.file)) return false;
	if (!isFiniteInteger(value.startLine) || value.startLine < 1) return false;
	if (!isOptionalPositiveInteger(value.startColumn)) return false;
	if (!isOptionalPositiveInteger(value.endLine)) return false;
	if (!isOptionalPositiveInteger(value.endColumn)) return false;
	if (typeof value.endLine === "number" && value.endLine < value.startLine) return false;
	if (!isNonEmptyString(value.title)) return false;
	if (!isNonEmptyString(value.explanation)) return false;
	if (!isNonEmptyString(value.suggestedFix)) return false;
	if (value.status !== "open" && value.status !== "ignored") return false;
	return true;
}

function isValidCurrentIndex(value: unknown, findings: unknown[]): boolean {
	if (!isFiniteInteger(value)) return false;
	if (findings.length === 0) return value === 0;
	return value >= 0 && value < findings.length;
}

function isPersistedQnaTurn(value: unknown): value is ReviewQnaTurn {
	if (!isObject(value)) return false;
	return (
		typeof value.question === "string" &&
		typeof value.answer === "string" &&
		typeof value.timestamp === "number" &&
		Number.isFinite(value.timestamp)
	);
}

function isPersistedQnaMap(value: unknown): value is Record<string, ReviewQnaTurn[]> {
	if (!isObject(value)) return false;
	return Object.values(value).every((turns) => Array.isArray(turns) && turns.every(isPersistedQnaTurn));
}

function migratePersistedReviewState(value: unknown): ReviewRunState | undefined {
	if (!isObject(value)) return undefined;
	if (value.kind !== "review-state") return undefined;
	if (typeof value.runId !== "string") return undefined;
	if (typeof value.createdAt !== "number") return undefined;
	if (!isPersistedReviewTarget(value.target)) return undefined;
	if (typeof value.rawReviewOutput !== "string") return undefined;
	if (!Array.isArray(value.findings)) return undefined;
	if (!value.findings.every(isPersistedReviewFinding)) return undefined;
	if (!isValidCurrentIndex(value.currentIndex, value.findings)) return undefined;
	if (value.qnaByFindingId !== undefined && !isPersistedQnaMap(value.qnaByFindingId)) return undefined;
	if (value.qnaByFindingId !== undefined) return value as unknown as ReviewRunState;
	return {
		...value,
		qnaByFindingId: value.qnaByFindingId ?? {},
	} as ReviewRunState;
}

function persistedStateFromEntry(entry: any): unknown {
	if (entry?.type === "custom" && entry.customType === REVIEW_STATE_ENTRY_TYPE) {
		return entry.data;
	}
	if (entry?.type === "custom_message" && entry.customType === REVIEW_STATE_ENTRY_TYPE) {
		return entry.details;
	}
	if (
		entry?.type === "message" &&
		entry.message?.role === "custom" &&
		entry.message.customType === REVIEW_STATE_ENTRY_TYPE
	) {
		return entry.message.details;
	}
	return undefined;
}

export function rebuildLatestReviewState(entries: Array<any>): ReviewRunState | undefined {
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const state = persistedStateFromEntry(entries[i]);
		const migrated = migratePersistedReviewState(state);
		if (migrated) return migrated;
	}
	return undefined;
}
