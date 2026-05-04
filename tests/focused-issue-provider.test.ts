import { describe, expect, it, vi } from "vitest";

import { createLinearProvider, normalizeLinearIssue, parseLinearReference } from "../extensions/focused-issue/linear.ts";
import { findProvider, unsupportedReferenceError } from "../extensions/focused-issue/providers.ts";
import type { IssueProvider } from "../extensions/focused-issue/types.ts";

describe("focused issue providers", () => {
	it("selects the first provider that supports a reference", () => {
		const providers: IssueProvider[] = [
			{
				id: "other",
				label: "Other",
				canHandle: () => false,
				fetchIssue: vi.fn(),
			},
			createLinearProvider({ apiKey: "test" }),
		];

		expect(findProvider("ENG-123", providers)?.id).toBe("linear");
		expect(findProvider("not an issue", providers)).toBeUndefined();
		expect(unsupportedReferenceError("not an issue")).toEqual({
			code: "unsupported",
			message: 'No issue provider supports "not an issue".',
			retryable: false,
		});
	});

	it("parses Linear issue keys with arbitrary team prefixes", () => {
		expect(parseLinearReference("ENG-123")).toEqual({
			kind: "key",
			lookup: "ENG-123",
			display: "ENG-123",
		});
		expect(parseLinearReference("PLAT-987")).toEqual({
			kind: "key",
			lookup: "PLAT-987",
			display: "PLAT-987",
		});
		expect(parseLinearReference("eng-123")).toBeNull();
	});

	it("parses Linear URLs", () => {
		expect(parseLinearReference("https://linear.app/acme/issue/ENG-123/add-focused-issue")).toEqual({
			kind: "url",
			lookup: "ENG-123",
			display: "ENG-123",
		});
		expect(parseLinearReference("https://example.com/acme/issue/ENG-123")).toBeNull();
	});

	it("normalizes Linear metadata and associated pull requests", () => {
		const issue = normalizeLinearIssue({
			id: "issue-id",
			identifier: "ENG-123",
			title: "Add focused issue extension",
			url: "https://linear.app/acme/issue/ENG-123",
			description: "Task details",
			createdAt: "2026-05-01T10:00:00.000Z",
			updatedAt: "2026-05-02T10:00:00.000Z",
			state: { name: "In Progress", type: "started" },
			assignee: { name: "Chris" },
			labels: { nodes: [{ name: "agent" }, { name: "extension" }] },
			attachments: {
				nodes: [
					{
						title: "PR #42",
						subtitle: "my-org/my-repo",
						url: "https://github.com/my-org/my-repo/pull/42",
					},
					{ title: "Design", url: "https://docs.example.com/design" },
				],
			},
		});

		expect(issue).toMatchObject({
			providerId: "linear",
			id: "issue-id",
			key: "ENG-123",
			title: "Add focused issue extension",
			status: "In Progress",
			statusType: "started",
			assignee: "Chris",
			labels: ["agent", "extension"],
			pullRequests: [
				{
					title: "PR #42",
					url: "https://github.com/my-org/my-repo/pull/42",
					repository: "my-org/my-repo",
				},
			],
		});
	});

	it("returns an auth error when Linear credentials are unavailable", async () => {
		const provider = createLinearProvider({ apiKey: "" });
		const result = await provider.fetchIssue("ENG-123", new AbortController().signal);

		expect(result).toEqual({
			ok: false,
			error: {
				code: "auth",
				message: "Set LINEAR_API_KEY to fetch Linear issue metadata.",
				retryable: true,
			},
		});
	});

	it("fetches Linear issue metadata through GraphQL", async () => {
		const fetcher = vi.fn(async () =>
			new Response(
				JSON.stringify({
					data: {
						issue: {
							id: "issue-id",
							identifier: "ENG-123",
							title: "Fetched issue",
							labels: { nodes: [] },
							attachments: { nodes: [] },
						},
					},
				}),
				{ status: 200 },
			),
		);
		const provider = createLinearProvider({ apiKey: "lin_api_key", fetcher });

		const result = await provider.fetchIssue("ENG-123", new AbortController().signal);

		expect(result).toMatchObject({
			ok: true,
			issue: {
				key: "ENG-123",
				title: "Fetched issue",
			},
		});
		expect(fetcher).toHaveBeenCalledWith(
			"https://api.linear.app/graphql",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({ Authorization: "lin_api_key" }),
			}),
		);
	});

	it("maps Linear fetch failures to retryable provider errors", async () => {
		const fetcher = vi.fn(async () => new Response("nope", { status: 500 }));
		const provider = createLinearProvider({ apiKey: "lin_api_key", fetcher });

		const result = await provider.fetchIssue("ENG-123", new AbortController().signal);

		expect(result).toEqual({
			ok: false,
			error: {
				code: "network",
				message: "Linear request failed with HTTP 500.",
				retryable: true,
			},
		});
	});
});
