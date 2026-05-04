import {
	FOCUSED_ISSUE_CUSTOM_TYPE,
	type FocusedIssue,
	type FocusedIssueState,
	type FocusedIssueSnapshot,
} from "./types.ts";

function compactText(value: string | undefined, maxLength: number): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim().replace(/\s+/g, " ");
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function formatFocusedIssueContext(issue: FocusedIssue): string {
	const lines = [
		"Focused issue context:",
		`- Provider: ${issue.providerId}`,
		`- Issue: ${issue.key}`,
		`- Title: ${issue.title}`,
		issue.url ? `- URL: ${issue.url}` : undefined,
		issue.status ? `- Status: ${issue.status}` : undefined,
		issue.assignee ? `- Assignee: ${issue.assignee}` : undefined,
		issue.labels.length ? `- Labels: ${issue.labels.slice(0, 8).join(", ")}` : undefined,
		issue.updatedAt ? `- Updated: ${issue.updatedAt}` : undefined,
		issue.description ? `- Description: ${compactText(issue.description, 1600)}` : undefined,
		issue.pullRequests.length
			? [
					"- Associated PRs:",
					...issue.pullRequests.slice(0, 5).map((pullRequest) => {
						const bits = [
							pullRequest.title,
							pullRequest.status ? `status: ${pullRequest.status}` : undefined,
							pullRequest.repository ? `repo: ${pullRequest.repository}` : undefined,
							pullRequest.url,
						].filter((bit): bit is string => Boolean(bit));
						return `  - ${bits.join(" | ")}`;
					}),
				].join("\n")
			: undefined,
		"",
		"Use this issue as the primary task context for the next response.",
	];
	return lines.filter((line): line is string => line !== undefined).join("\n");
}

export function formatPendingIssueContext(state: FocusedIssueState): string {
	return [
		"Focused issue context:",
		`- Issue reference: ${state.reference ?? "unknown"}`,
		`- Provider: ${state.providerId ?? "pending"}`,
		"- Status: metadata is still loading asynchronously.",
		"",
		"Do not wait for the external issue fetch. If the user asks to implement the task before metadata is available, ask for details or proceed only with context already present.",
	].join("\n");
}

export function shouldInjectReady(state: FocusedIssueState): boolean {
	return state.status === "ready" && state.issue !== null && state.lastInjectedVersion !== state.version;
}

export function shouldInjectPending(state: FocusedIssueState): boolean {
	return (
		(state.status === "loading" || state.status === "stale") &&
		state.reference !== null &&
		state.pendingInjectedVersion !== state.version
	);
}

export function buildFocusedIssueMessage(content: string, snapshot: FocusedIssueSnapshot): {
	customType: string;
	content: string;
	display: boolean;
	details: FocusedIssueSnapshot;
} {
	return {
		customType: FOCUSED_ISSUE_CUSTOM_TYPE,
		content,
		display: false,
		details: snapshot,
	};
}
