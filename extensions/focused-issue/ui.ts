import { getMarkdownTheme, type Theme } from "@mariozechner/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth, type Component, type MarkdownTheme } from "@mariozechner/pi-tui";

import type { FocusedIssueState } from "./types.ts";

const MAX_PANEL_CONTENT_LINES = 14;
const STATUSLINE_TEXT = "Ctrl+Shift+Up / Ctrl+Shift+Down scroll";

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
		const createdAt = state.issue.createdAt
			? "Updated " + formatRelativeTime(Date.parse(state.issue.createdAt), now)
			: undefined;
		lines.push(`# [${state.issue.key}: ${state.issue.title}](${state.issue.url})`);

		lines.push("");

		const parts = [
			state.issue.status && `*${state.issue.status}*`,
			state.issue.assignee && `*${state.issue.assignee}*`,
			createdAt && `*${createdAt}*`,
		].filter((part): part is string => Boolean(part));

		if (parts.length) {
			lines.push(parts.join(" | "));
		}

		const description = state.issue.description;
		if (description) {
			lines.push("");
			lines.push(description);
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
	scrollOffset = 0,
	statusColor: (text: string) => string = (text) => text,
	onScrollOffsetChange?: (scrollOffset: number) => void,
): string[] {
	const markdown = formatFocusedIssueMarkdown(state, now);
	if (!markdown) return [];
	return renderBorderedMarkdown(markdown, Math.max(24, width), markdownTheme, borderColor, scrollOffset, statusColor, onScrollOffsetChange);
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
		private readonly getScrollOffset: () => number = () => 0,
		private readonly setScrollOffset: (scrollOffset: number) => void = () => { },
	) { }

	render(width: number): string[] {
		return renderFocusedIssueWidgetLines(
			this.getState(),
			width,
			this.now(),
			getMarkdownTheme(),
			(text) => this.theme.fg("borderAccent", text),
			this.getScrollOffset(),
			(text) => this.theme.fg("muted", text),
			this.setScrollOffset,
		);
	}

	invalidate(): void {
		// State is read lazily during render.
	}
}

export function makeFocusedIssueWidgetFactory(
	getState: () => FocusedIssueState,
	now: () => number = Date.now,
	getScrollOffset: () => number = () => 0,
	setScrollOffset: (scrollOffset: number) => void = () => { },
) {
	return (_tui: unknown, theme: Theme): Component => new FocusedIssueWidget(getState, theme, now, getScrollOffset, setScrollOffset);
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
	scrollOffset: number,
	statusColor: (text: string) => string,
	onScrollOffsetChange: ((scrollOffset: number) => void) | undefined,
): string[] {
	const innerWidth = Math.max(8, width - 4);
	const rendered = new Markdown(markdown, 0, 0, markdownTheme).render(innerWidth);
	const { lines: visible, scrollOffset: effectiveScrollOffset } = sliceScrollableLines(rendered, scrollOffset);
	if (effectiveScrollOffset !== scrollOffset) {
		onScrollOffsetChange?.(effectiveScrollOffset);
	}
	const statusLine = `${borderColor("│")} ${padLine(statusColor(STATUSLINE_TEXT), innerWidth)} ${borderColor("│")}`;

	const top = borderColor(`╭${"─".repeat(Math.max(0, width - 2))}╮`);
	const bottom = borderColor(`╰${"─".repeat(Math.max(0, width - 2))}╯`);
	const body = visible.map((line) => `${borderColor("│")} ${padLine(line, innerWidth)} ${borderColor("│")}`);
	return [top, ...body, statusLine, bottom];
}

function sliceScrollableLines(rendered: string[], rawScrollOffset: number): { lines: string[]; scrollOffset: number } {
	const maxBodyLines = MAX_PANEL_CONTENT_LINES + 1;
	if (rendered.length <= MAX_PANEL_CONTENT_LINES) return { lines: rendered, scrollOffset: 0 };

	const maxOffset = Math.max(0, rendered.length - MAX_PANEL_CONTENT_LINES);
	const scrollOffset = Math.max(0, Math.min(Math.floor(rawScrollOffset), maxOffset));
	if (scrollOffset === 0) {
		return { lines: [...rendered.slice(0, MAX_PANEL_CONTENT_LINES), "↓ …"], scrollOffset };
	}

	const hasMoreBelow = scrollOffset + MAX_PANEL_CONTENT_LINES < rendered.length;
	const contentLineCount = maxBodyLines - 1 - (hasMoreBelow ? 1 : 0);
	return {
		lines: [
			"↑ …",
			...rendered.slice(scrollOffset, scrollOffset + contentLineCount),
			...(hasMoreBelow ? ["↓ …"] : []),
		],
		scrollOffset,
	};
}
