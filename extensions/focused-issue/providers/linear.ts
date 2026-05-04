import type { FocusedIssue, IssueProvider, IssueProviderError, IssueProviderResult, IssuePullRequest } from "../types.ts";

export interface LinearReference {
	kind: "key" | "url";
	lookup: string;
	display: string;
}

export interface LinearProviderOptions {
	apiKey?: string;
	fetcher?: typeof fetch;
	endpoint?: string;
}

const LINEAR_ENDPOINT = "https://api.linear.app/graphql";
const ISSUE_KEY_PATTERN = /\b([A-Z][A-Z0-9]+-\d+)\b/;

const ISSUE_QUERY = `
query FocusedIssue($id: String!) {
	issue(id: $id) {
		id
		identifier
		title
		url
		description
		createdAt
		updatedAt
		state {
			name
			type
		}
		assignee {
			name
			email
		}
		labels {
			nodes {
				name
			}
		}
		attachments {
			nodes {
				id
				title
				subtitle
				url
			}
		}
	}
}
`;

export function parseLinearReference(input: string): LinearReference | null {
	const reference = input.trim();
	if (!reference) return null;

	const keyMatch = ISSUE_KEY_PATTERN.exec(reference);
	if (!reference.includes("://")) {
		return keyMatch
			? { kind: "key", lookup: keyMatch[1]!, display: keyMatch[1]! }
			: null;
	}

	let url: URL;
	try {
		url = new URL(reference);
	} catch {
		return null;
	}

	if (!url.hostname.endsWith("linear.app")) return null;
	if (keyMatch) {
		return { kind: "url", lookup: keyMatch[1]!, display: keyMatch[1]! };
	}

	const slug = url.pathname.split("/").filter(Boolean).at(-1);
	return slug ? { kind: "url", lookup: slug, display: slug } : null;
}

function providerError(code: IssueProviderError["code"], message: string, retryable: boolean): IssueProviderError {
	return { code, message, retryable };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function nodesFrom(value: unknown): unknown[] {
	if (!isRecord(value) || !Array.isArray(value.nodes)) return [];
	return value.nodes;
}

function normalizePullRequests(attachments: unknown): IssuePullRequest[] {
	return nodesFrom(attachments)
		.filter(isRecord)
		.map((attachment) => {
			const title = stringValue(attachment.title) ?? stringValue(attachment.subtitle) ?? "Pull request";
			const url = stringValue(attachment.url) ?? "";
			const repository = stringValue(attachment.subtitle);
			return { title, url, repository };
		})
		.filter((pullRequest) => pullRequest.url.includes("github.com") || pullRequest.url.includes("gitlab.com"));
}

export function normalizeLinearIssue(issue: unknown): FocusedIssue | null {
	if (!isRecord(issue)) return null;
	const id = stringValue(issue.id);
	const key = stringValue(issue.identifier);
	const title = stringValue(issue.title);
	if (!id || !key || !title) return null;

	const state = isRecord(issue.state) ? issue.state : {};
	const assignee = isRecord(issue.assignee) ? issue.assignee : {};
	const labels = nodesFrom(issue.labels)
		.filter(isRecord)
		.map((label) => stringValue(label.name))
		.filter((label): label is string => Boolean(label));

	return {
		providerId: "linear",
		id,
		key,
		title,
		url: stringValue(issue.url),
		description: stringValue(issue.description),
		status: stringValue(state.name),
		statusType: stringValue(state.type),
		assignee: stringValue(assignee.name) ?? stringValue(assignee.email),
		labels,
		pullRequests: normalizePullRequests(issue.attachments),
		createdAt: stringValue(issue.createdAt),
		updatedAt: stringValue(issue.updatedAt),
		raw: issue,
	};
}

export function createLinearProvider(options: LinearProviderOptions = {}): IssueProvider {
	const apiKey = options.apiKey ?? process.env.LINEAR_API_KEY;
	const fetcher = options.fetcher ?? fetch;
	const endpoint = options.endpoint ?? LINEAR_ENDPOINT;

	return {
		id: "linear",
		label: "Linear",
		canHandle(reference) {
			return parseLinearReference(reference) !== null;
		},
		async fetchIssue(reference, signal): Promise<IssueProviderResult> {
			const parsed = parseLinearReference(reference);
			if (!parsed) {
				return { ok: false, error: providerError("invalid", "Could not parse Linear issue reference.", false) };
			}
			if (!apiKey) {
				return {
					ok: false,
					error: providerError("auth", "Set LINEAR_API_KEY to fetch Linear issue metadata.", true),
				};
			}

			let response: Response;
			try {
				response = await fetcher(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: apiKey,
					},
					body: JSON.stringify({ query: ISSUE_QUERY, variables: { id: parsed.lookup } }),
					signal,
				});
			} catch (error) {
				if (signal.aborted) {
					return { ok: false, error: providerError("cancelled", "Issue fetch was cancelled.", true) };
				}
				const message = error instanceof Error ? error.message : "Network error while fetching Linear issue.";
				return { ok: false, error: providerError("network", message, true) };
			}

			if (response.status === 401 || response.status === 403) {
				return { ok: false, error: providerError("auth", "Linear rejected the configured API key.", true) };
			}
			if (!response.ok) {
				return {
					ok: false,
					error: providerError("network", `Linear request failed with HTTP ${response.status}.`, true),
				};
			}

			const body = (await response.json()) as unknown;
			if (!isRecord(body)) {
				return { ok: false, error: providerError("unknown", "Linear returned an invalid response.", true) };
			}
			if (Array.isArray(body.errors) && body.errors.length > 0) {
				return {
					ok: false,
					error: providerError("unknown", "Linear returned GraphQL errors while fetching the issue.", true),
				};
			}

			const data = isRecord(body.data) ? body.data : {};
			const issue = normalizeLinearIssue(data.issue);
			if (!issue) {
				return {
					ok: false,
					error: providerError("not_found", `Linear issue "${parsed.display}" was not found.`, false),
				};
			}
			return { ok: true, issue };
		},
	};
}
