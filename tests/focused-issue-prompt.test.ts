import { describe, expect, it } from "vitest";

import {
	buildFocusedIssueMessage,
	formatFocusedIssueContext,
	formatPendingIssueContext,
	shouldInjectPending,
	shouldInjectReady,
} from "../extensions/focused-issue/prompt.ts";
import type { FocusedIssue, FocusedIssueState } from "../extensions/focused-issue/types.ts";

function issue(): FocusedIssue {
	return {
		providerId: "linear",
		id: "issue-id",
		key: "ENG-123",
		title: "Add focused issue extension",
		url: "https://linear.app/acme/issue/ENG-123",
		description: "Implement the sticky issue panel and prompt context.",
		status: "Todo",
		assignee: "Chris",
		labels: ["extension", "agent"],
		pullRequests: [{ title: "PR #42", url: "https://github.com/acme/pi/pull/42", repository: "acme/pi" }],
		updatedAt: "2026-05-04T10:00:00.000Z",
	};
}

function state(overrides: Partial<FocusedIssueState>): FocusedIssueState {
	return {
		status: "idle",
		reference: null,
		providerId: null,
		issue: null,
		error: null,
		version: 1,
		lastInjectedVersion: 0,
		pendingInjectedVersion: 0,
		fetchedAt: null,
		token: 1,
		...overrides,
	};
}

describe("focused issue prompt context", () => {
	it("formats ready issue metadata compactly", () => {
		const context = formatFocusedIssueContext(issue());

		expect(context).toContain("Issue: ENG-123");
		expect(context).toContain("Title: Add focused issue extension");
		expect(context).toContain("Assignee: Chris");
		expect(context).toContain("Associated PRs");
		expect(context).toContain("https://github.com/acme/pi/pull/42");
	});

	it("formats pending metadata without claiming details are loaded", () => {
		const context = formatPendingIssueContext(state({ status: "loading", reference: "ENG-123", providerId: "linear" }));

		expect(context).toContain("Issue reference: ENG-123");
		expect(context).toContain("metadata is still loading asynchronously");
	});

	it("detects one-shot ready and pending injection eligibility", () => {
		expect(shouldInjectReady(state({ status: "ready", issue: issue(), version: 2, lastInjectedVersion: 1 }))).toBe(true);
		expect(shouldInjectReady(state({ status: "ready", issue: issue(), version: 2, lastInjectedVersion: 2 }))).toBe(false);
		expect(shouldInjectPending(state({ status: "loading", reference: "ENG-123", version: 2, pendingInjectedVersion: 1 }))).toBe(true);
		expect(shouldInjectPending(state({ status: "loading", reference: "ENG-123", version: 2, pendingInjectedVersion: 2 }))).toBe(false);
	});

	it("builds hidden custom messages with snapshot details", () => {
		const snapshot = state({ status: "ready", issue: issue() });

		expect(buildFocusedIssueMessage("content", snapshot)).toEqual({
			customType: "focused-issue-context",
			content: "content",
			display: false,
			details: snapshot,
		});
	});
});
