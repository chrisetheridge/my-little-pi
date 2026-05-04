export const FOCUSED_ISSUE_CUSTOM_TYPE = "focused-issue-context";
export const FOCUSED_ISSUE_STATE_TYPE = "focused-issue-state";
export const FOCUSED_ISSUE_WIDGET_KEY = "focused-issue";

export type IssueProviderId = "linear" | (string & {});

export interface IssuePullRequest {
	title: string;
	url: string;
	status?: string;
	repository?: string;
}

export interface FocusedIssue {
	providerId: IssueProviderId;
	id: string;
	key: string;
	title: string;
	url?: string;
	description?: string;
	status?: string;
	statusType?: string;
	assignee?: string;
	labels: string[];
	pullRequests: IssuePullRequest[];
	createdAt?: string;
	updatedAt?: string;
	raw?: unknown;
}

export interface IssueProviderError {
	code: "unsupported" | "not_found" | "auth" | "network" | "cancelled" | "invalid" | "unknown";
	message: string;
	retryable: boolean;
}

export type IssueProviderResult =
	| { ok: true; issue: FocusedIssue }
	| { ok: false; error: IssueProviderError };

export interface IssueProvider {
	id: IssueProviderId;
	label: string;
	canHandle(reference: string): boolean;
	extractReference?: (text: string) => string | null;
	fetchIssue(reference: string, signal: AbortSignal): Promise<IssueProviderResult>;
}

export type FocusStatus = "idle" | "loading" | "ready" | "stale" | "error";

export interface FocusedIssueSnapshot {
	status: FocusStatus;
	reference: string | null;
	providerId: IssueProviderId | null;
	issue: FocusedIssue | null;
	error: IssueProviderError | null;
	version: number;
	lastInjectedVersion: number;
	pendingInjectedVersion: number;
	fetchedAt: number | null;
}

export interface FocusedIssueState extends FocusedIssueSnapshot {
	token: number;
}
