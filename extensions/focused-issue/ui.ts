import { getMarkdownTheme, type Theme } from "@mariozechner/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth, type Component, type MarkdownTheme } from "@mariozechner/pi-tui";

import type { FocusedIssueState } from "./types.ts";

const MAX_PANEL_CONTENT_LINES = 8;

function compactText(value: string | undefined, maxLength: number): string | undefined {
	if (!value) return undefined;
	const normalized = value.trim().replace(/\s+/g, " ");
	if (normalized.length <= maxLength) return normalized;
	return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatRelativeTime(timestamp: number | null, now: number): string | undefined {
	if (!timestamp) return undefined;
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

function markdownLink(label: string, url: string): string {
	return `[${label}](${url})`;
}

function escapeTableCell(value: string): string {
	return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function formatFocusedIssueMarkdown(state: FocusedIssueState, now = Date.now()): string {
	if (state.status === "idle" || !state.reference) return "";

	const marker = state.status === "ready" ? "Ready" : state.status === "stale" ? "Stale" : state.status === "error" ? "Error" : "Loading";
	const lines: string[] = [];

	if (state.issue) {
		const fetched = formatRelativeTime(state.fetchedAt, now);
		lines.push(`### ${state.issue.key}: ${state.issue.title}`);
		lines.push("");
		lines.push(`- **State:** ${marker}`);
		if (state.issue.status) lines.push(`- **Status:** ${state.issue.status}`);
		if (state.issue.assignee) lines.push(`- **Assignee:** ${state.issue.assignee}`);
		if (fetched) lines.push(`- **Fetched:** ${fetched}`);
		if (state.issue.url) lines.push(`- **URL:** ${markdownLink(state.issue.url, state.issue.url)}`);

		const description = compactText(state.issue.description, 260);
		if (description) {
			lines.push("");
			lines.push(description);
		}

		if (state.issue.labels.length) {
			lines.push("");
			lines.push(`**Labels:** ${state.issue.labels.slice(0, 8).map((label) => `\`${label}\``).join(" ")}`);
		}

		if (state.issue.pullRequests.length) {
			lines.push("");
			lines.push("| PR | Status | Repository |");
			lines.push("| --- | --- | --- |");
			for (const pullRequest of state.issue.pullRequests.slice(0, 3)) {
				const title = pullRequest.url
					? markdownLink(escapeTableCell(pullRequest.title), pullRequest.url)
					: escapeTableCell(pullRequest.title);
				lines.push(`| ${title} | ${escapeTableCell(pullRequest.status ?? "")} | ${escapeTableCell(pullRequest.repository ?? "")} |`);
			}
		}
	} else {
		lines.push(`### Focused issue: ${state.reference}`);
		lines.push("");
		lines.push(`- **State:** ${marker}`);
	}

	if (state.error) {
		lines.push("");
		lines.push(`> ${state.error.message}`);
		if (state.error.retryable) {
			lines.push("");
			lines.push("Run `/focus-issue refresh` to retry.");
		}
	}

	if (state.status === "loading") {
		lines.push("");
		lines.push("_Metadata loading asynchronously._");
	}
	if (state.status === "stale") {
		lines.push("");
		lines.push("_Refreshing metadata asynchronously._");
	}

	return lines.join("\n");
}

export function renderFocusedIssueWidgetLines(
	state: FocusedIssueState,
	width: number,
	now = Date.now(),
	markdownTheme: MarkdownTheme = getMarkdownTheme(),
	borderColor: (text: string) => string = (text) => text,
): string[] {
	const markdown = formatFocusedIssueMarkdown(state, now);
	if (!markdown) return [];
	return renderBorderedMarkdown(markdown, Math.max(24, width), markdownTheme, borderColor);
}

export function renderFocusedIssuePlainLines(state: FocusedIssueState, now = Date.now()): string[] {
	const markdown = formatFocusedIssueMarkdown(state, now);
	if (!markdown) return [];
	return markdown
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/[`*_>#]/g, "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

export class FocusedIssueWidget implements Component {
	constructor(
		private readonly getState: () => FocusedIssueState,
		private readonly theme: Theme,
		private readonly now: () => number = Date.now,
	) {}

	render(width: number): string[] {
		return renderFocusedIssueWidgetLines(
			this.getState(),
			width,
			this.now(),
			getMarkdownTheme(),
			(text) => this.theme.fg("borderAccent", text),
		);
	}

	invalidate(): void {
		// State is read lazily during render.
	}
}

export function makeFocusedIssueWidgetFactory(getState: () => FocusedIssueState, now: () => number = Date.now) {
	return (_tui: unknown, theme: Theme): Component => new FocusedIssueWidget(getState, theme, now);
}

function padLine(line: string, width: number): string {
	const clipped = truncateToWidth(line, width);
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function renderBorderedMarkdown(
	markdown: string,
	width: number,
	markdownTheme: MarkdownTheme,
	borderColor: (text: string) => string,
): string[] {
	const innerWidth = Math.max(8, width - 4);
	const rendered = new Markdown(markdown, 0, 0, markdownTheme).render(innerWidth);
	const visible = rendered.slice(0, MAX_PANEL_CONTENT_LINES);
	if (rendered.length > visible.length) {
		visible.push("…");
	}

	const top = borderColor(`╭${"─".repeat(Math.max(0, width - 2))}╮`);
	const bottom = borderColor(`╰${"─".repeat(Math.max(0, width - 2))}╯`);
	const body = visible.map((line) => `${borderColor("│")} ${padLine(line, innerWidth)} ${borderColor("│")}`);
	return [top, ...body, bottom];
}
