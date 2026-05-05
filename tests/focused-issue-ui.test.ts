import { describe, expect, it } from "vitest";
import { visibleWidth, type MarkdownTheme } from "@mariozechner/pi-tui";

import { formatFocusedIssueMarkdown, renderFocusedIssueWidgetLines } from "../extensions/focused-issue/ui.ts";
import type { FocusedIssueState } from "../extensions/focused-issue/types.ts";

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

const plainMarkdownTheme: MarkdownTheme = {
	heading: (text) => text,
	link: (text) => text,
	linkUrl: (text) => text,
	code: (text) => text,
	codeBlock: (text) => text,
	codeBlockBorder: (text) => text,
	quote: (text) => text,
	quoteBorder: (text) => text,
	hr: (text) => text,
	listBullet: (text) => text,
	bold: (text) => text,
	italic: (text) => text,
	strikethrough: (text) => text,
	underline: (text) => text,
};

describe("focused issue sticky UI", () => {
	it("renders loading state", () => {
		const markdown = formatFocusedIssueMarkdown(state({ status: "loading", reference: "ENG-123", providerId: "linear" }));

		expect(markdown).toContain("### Focused issue: ENG-123");
		expect(markdown).toContain("- **State:** Loading");
		expect(markdown).toContain("_Metadata loading asynchronously._");
	});

	it("renders ready metadata with optional fields", () => {
		const markdown = formatFocusedIssueMarkdown(
			state({
				status: "ready",
				reference: "ENG-123",
				providerId: "linear",
				fetchedAt: 1000,
				issue: {
					providerId: "linear",
					id: "issue-id",
					key: "ENG-123",
					title: "Add focused issue extension",
					description: "A longer task description that should fit in the widget.",
					status: "In Progress",
					assignee: "Chris",
					url: "https://linear.app/acme/issue/ENG-123",
					labels: ["extension", "agent"],
					pullRequests: [
						{ title: "PR #42", url: "https://github.com/acme/pi/pull/42", repository: "acme/pi" },
						{ title: "PR #43", url: "https://github.com/acme/pi/pull/43", status: "merged" },
					],
				},
			}),
			61_000,
		);

		expect(markdown).toContain("[ENG-123: Add focused issue extension](https://linear.app/acme/issue/ENG-123)");
		expect(markdown).toContain("In Progress");
		expect(markdown).toContain("Chris");
		expect(markdown).toContain("| PR | Status | Repository |");
		expect(markdown).toContain("| [PR #42](https://github.com/acme/pi/pull/42) |  | acme/pi |");
		expect(markdown).toContain("| [PR #43](https://github.com/acme/pi/pull/43) | merged |  |");
	});

	it("renders retryable error state", () => {
		const markdown = formatFocusedIssueMarkdown(
			state({
				status: "error",
				reference: "ENG-123",
				error: { code: "network", message: "offline", retryable: true },
			}),
		);

		expect(markdown).toContain("> offline");
		expect(markdown).toContain("`/focus-issue refresh`");
	});

	it("keeps narrow output within the requested width", () => {
		const width = 34;
		const lines = renderFocusedIssueWidgetLines(
			state({
				status: "ready",
				reference: "ENG-123",
				issue: {
					providerId: "linear",
					id: "issue-id",
					key: "ENG-123",
					title: "A very long title that must be clipped",
					labels: [],
					pullRequests: [],
				},
			}),
			width,
			Date.now(),
			plainMarkdownTheme,
		);

		expect(lines.every((line) => visibleWidth(line) === width)).toBe(true);
	});

	it("wraps markdown in a bordered TUI panel", () => {
		const lines = renderFocusedIssueWidgetLines(
			state({ status: "loading", reference: "ENG-123", providerId: "linear" }),
			50,
			Date.now(),
			plainMarkdownTheme,
		);

		expect(lines.length).toBeGreaterThan(0);
		expect(lines[0]).toBe(`╭${"─".repeat(48)}╮`);
		expect(lines.at(-1)).toBe(`╰${"─".repeat(48)}╯`);
		expect(lines.slice(1, -1).every((line) => line.startsWith("│ ") && line.endsWith(" │"))).toBe(true);
		expect(lines.join("\n")).toContain("Focused issue: ENG-123");
	});

	it("renders a bottom statusline with focused issue shortcuts", () => {
		const lines = renderFocusedIssueWidgetLines(
			state({ status: "loading", reference: "ENG-123", providerId: "linear" }),
			80,
			Date.now(),
			plainMarkdownTheme,
		);

		const statusline = lines.at(-2);
		expect(statusline).toContain("Scroll: Ctrl+Shift+Up/Down");
		expect(statusline).toContain("Close: Ctrl+Shift+W");
		expect(statusline).toContain("Ctrl+Shift+W");
		expect(statusline).toMatch(/^│\s{2,}Scroll:/);
		expect(statusline?.endsWith("Scroll: Ctrl+Shift+Up/Down  Close: Ctrl+Shift+W │")).toBe(true);
		expect(visibleWidth(statusline ?? "")).toBe(80);
	});

	it("caps panel height to avoid crowding the statusline", () => {
		const lines = renderFocusedIssueWidgetLines(
			state({
				status: "ready",
				reference: "ENG-123",
				issue: {
					providerId: "linear",
					id: "issue-id",
					key: "ENG-123",
					title: "A long issue",
					description: "Long ".repeat(120),
					labels: ["one", "two", "three", "four", "five", "six"],
					pullRequests: [
						{ title: "PR #1", url: "https://github.com/acme/pi/pull/1" },
						{ title: "PR #2", url: "https://github.com/acme/pi/pull/2" },
						{ title: "PR #3", url: "https://github.com/acme/pi/pull/3" },
					],
				},
			}),
			80,
			Date.now(),
			plainMarkdownTheme,
		);

		expect(lines.length).toBeLessThanOrEqual(18);
		expect(lines.at(-3)).toContain("…");
	});

	it("renders a later slice when the focused issue panel is scrolled", () => {
		const longDescription = Array.from({ length: 30 }, (_, index) => `Line ${String(index + 1).padStart(2, "0")}`).join("\n");

		const atTop = renderFocusedIssueWidgetLines(
			state({
				status: "ready",
				reference: "ENG-123",
				issue: {
					providerId: "linear",
					id: "issue-id",
					key: "ENG-123",
					title: "Scrollable issue",
					description: longDescription,
					labels: [],
					pullRequests: [],
				},
			}),
			80,
			Date.now(),
			plainMarkdownTheme,
		).join("\n");
		const scrolled = renderFocusedIssueWidgetLines(
			state({
				status: "ready",
				reference: "ENG-123",
				issue: {
					providerId: "linear",
					id: "issue-id",
					key: "ENG-123",
					title: "Scrollable issue",
					description: longDescription,
					labels: [],
					pullRequests: [],
				},
			}),
			80,
			Date.now(),
			plainMarkdownTheme,
			(text) => text,
			10,
		).join("\n");

		expect(atTop).toContain("Line 01");
		expect(atTop).not.toContain("Line 20");
		expect(scrolled).toContain("Line 10");
		expect(scrolled).toContain("Line 20");
		expect(scrolled).not.toContain("Line 01");
		expect(scrolled).toContain("↑");
		expect(scrolled).toContain("↓");
	});

	it("reports the effective scroll offset when the requested offset is beyond the bottom", () => {
		const longDescription = Array.from({ length: 30 }, (_, index) => `Line ${String(index + 1).padStart(2, "0")}`).join("\n");
		let effectiveOffset: number | undefined;

		renderFocusedIssueWidgetLines(
			state({
				status: "ready",
				reference: "ENG-123",
				issue: {
					providerId: "linear",
					id: "issue-id",
					key: "ENG-123",
					title: "Scrollable issue",
					description: longDescription,
					labels: [],
					pullRequests: [],
				},
			}),
			80,
			Date.now(),
			plainMarkdownTheme,
			(text) => text,
			100,
			(text) => text,
			(offset) => {
				effectiveOffset = offset;
			},
		);

		expect(effectiveOffset).toBeGreaterThan(0);
		expect(effectiveOffset).toBeLessThan(100);
	});
});
