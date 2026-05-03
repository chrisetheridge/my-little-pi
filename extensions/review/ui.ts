import { type ExtensionCommandContext, type Theme } from "@mariozechner/pi-coding-agent";
import { Container, Key, matchesKey, Spacer, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { loadSourceExcerpt } from "./findings.ts";
import type { ReviewTarget } from "./git.ts";
import { discardFinding, updateReviewIndex, type ReviewRunState } from "./state.ts";

const FINDINGS_VIEWPORT_LINES = 11;

export type FindingsDialogResult = {
	submitted: boolean;
	state: ReviewRunState;
};

export async function chooseInitialMode(
	ctx: ExtensionCommandContext,
): Promise<"uncommitted" | "base" | "commit" | "pr" | null> {
	const selected = await ctx.ui.select("Review target", [
		"Uncommitted changes",
		"Local changes against base",
		"Specific commit",
		"Pull request URL",
	]);
	if (selected === "Uncommitted changes") return "uncommitted";
	if (selected === "Local changes against base") return "base";
	if (selected === "Specific commit") return "commit";
	if (selected === "Pull request URL") return "pr";
	return null;
}

export function formatPreflight(target: ReviewTarget): string {
	return [
		`Target: ${target.label}`,
		target.baseRef ? `Base: ${target.baseRef}` : undefined,
		target.mergeBase ? `Merge base: ${target.mergeBase}` : undefined,
		target.prUrl ? `Pull request: ${target.prUrl}` : undefined,
		target.originalRef ? `Original ref: ${target.originalRef}` : undefined,
		`Files: ${target.changedFiles.length}`,
		`Staged files: ${target.stagedCount}`,
		`Unstaged files: ${target.unstagedCount}`,
		"",
		target.changedFiles.length
			? target.changedFiles.map((file) => `- ${file}`).join("\n")
			: "No changed files detected.",
	]
		.filter((part): part is string => part !== undefined)
		.join("\n");
}

export async function confirmPreflight(ctx: ExtensionCommandContext, target: ReviewTarget): Promise<boolean> {
	return ctx.ui.confirm("Start code review?", formatPreflight(target));
}

export type RecoveryChoice = "retry" | "cancel";

export async function showParseRecovery(
	ctx: ExtensionCommandContext,
	error: Error,
	rawOutput: string,
): Promise<RecoveryChoice> {
	const preview = rawOutput.slice(0, 2000);
	const selected = await ctx.ui.select(
		[
			"Review findings parse failed.",
			"",
			error.message,
			"",
			"Raw output preview:",
			preview || "(empty output)",
		].join("\n"),
		[
			"Retry extraction",
			"Cancel",
		],
	);
	return selected === "Retry extraction" ? "retry" : "cancel";
}

export class FindingsDialog {
	private state: ReviewRunState;
	private statusMessage?: string;
	private scrollOffset = 0;
	private lastWidth = 100;

	constructor(
		state: ReviewRunState,
		private readonly cwd: string,
		private readonly theme: Theme,
		private readonly done: (result: FindingsDialogResult) => void,
		private readonly confirmClose: (state: ReviewRunState) => Promise<boolean>,
	) {
		const maxIndex = Math.max(0, state.findings.length - 1);
		this.state = state.currentIndex < 0 || state.currentIndex > maxIndex ? updateReviewIndex(state, state.currentIndex) : state;
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			if (this.state.findings.length === 0) {
				this.done({ submitted: false, state: this.state });
				return;
			}
			const openCount = this.state.findings.length;
			this.statusMessage = "Confirming close with findings still open...";
			this.invalidate();
			this.confirmClose(this.state)
				.then((confirmed) => {
					if (confirmed) {
						this.done({ submitted: false, state: this.state });
						return;
					}
					this.statusMessage = undefined;
					this.invalidate();
				})
				.catch(() => {
					this.statusMessage = undefined;
					this.invalidate();
				});
			return;
		}

		if (matchesKey(data, Key.enter) || data === "s") {
			this.done({ submitted: true, state: this.state });
			return;
		}

		if (this.state.findings.length === 0) return;
		if (matchesKey(data, Key.up) || data === "k") {
			this.scrollBy(-1);
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			this.scrollBy(1);
			return;
		}
		if (matchesKey(data, Key.pageUp)) {
			this.scrollBy(-FINDINGS_VIEWPORT_LINES);
			return;
		}
		if (matchesKey(data, Key.pageDown)) {
			this.scrollBy(FINDINGS_VIEWPORT_LINES);
			return;
		}
		if (matchesKey(data, Key.home)) {
			this.scrollOffset = 0;
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.end)) {
			this.scrollToBottom();
			return;
		}
		if (matchesKey(data, Key.right) || data === "n") {
			this.scrollOffset = 0;
			this.state = updateReviewIndex(this.state, this.state.currentIndex + 1);
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.left) || data === "p") {
			this.scrollOffset = 0;
			this.state = updateReviewIndex(this.state, this.state.currentIndex - 1);
			this.invalidate();
			return;
		}
		if (data === "f") {
			const finding = this.state.findings[this.state.currentIndex];
			if (!finding) return;
			this.statusMessage = "Marked fix.";
			this.state = updateReviewIndex(this.state, this.state.currentIndex + 1);
			this.scrollOffset = 0;
			this.invalidate();
			return;
		}
		if (data === "d") {
			const finding = this.state.findings[this.state.currentIndex];
			if (!finding) return;
			this.state = discardFinding(this.state, finding.id);
			this.statusMessage = "Discarded.";
			this.scrollOffset = 0;
			this.invalidate();
		}
	}

	render(width: number): string[] {
		this.lastWidth = width;
		return this.buildView(width);
	}

	invalidate(): void {
		// No cached render state to clear.
	}

	private buildView(width: number): string[] {
		const lines: string[] = [];
		const innerWidth = Math.max(0, width - 4);
		const bodyWidth = Math.max(20, innerWidth);
		const bodyLines = this.buildBodyContent(bodyWidth).render(bodyWidth);
		const maxScroll = Math.max(0, bodyLines.length - FINDINGS_VIEWPORT_LINES);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));
		const visibleBodyLines = bodyLines.slice(this.scrollOffset, this.scrollOffset + FINDINGS_VIEWPORT_LINES);

		lines.push(this.borderLine(width, "┌", "─", "┐"));
		lines.push(this.boxLine(width, this.theme.fg("accent", "Code review findings")));
		lines.push(this.boxLine(width, this.theme.fg("muted", this.state.target.label)));
		if (this.statusMessage) {
			lines.push(this.boxLine(width, this.theme.fg("dim", this.statusMessage)));
		}
		lines.push(this.borderLine(width, "├", "─", "┤"));

		if (visibleBodyLines.length === 0) {
			lines.push(this.boxLine(width, this.theme.fg("dim", "No findings.")));
		} else {
			for (const line of visibleBodyLines) {
				lines.push(this.boxLine(width, line));
			}
			for (let i = visibleBodyLines.length; i < FINDINGS_VIEWPORT_LINES; i += 1) {
				lines.push(this.boxLine(width, ""));
			}
		}

		lines.push(this.borderLine(width, "├", "─", "┤"));
		lines.push(this.boxLine(width, this.theme.fg("dim", truncateToWidth(this.buildFooterHint(maxScroll > 0), innerWidth))));
		lines.push(this.borderLine(width, "└", "─", "┘"));
		return lines;
	}

	private buildBodyContent(contentWidth: number): Container {
		const content = new Container();

		if (this.state.findings.length === 0) {
			content.addChild(new Text("No findings.", 0, 0));
			return content;
		}

		const finding = this.state.findings[this.state.currentIndex]!;
		const excerpt = loadSourceExcerpt(this.cwd, finding);
		const status = "FIX";

		content.addChild(
			new Text(
				this.theme.fg(
					"muted",
					truncateToWidth(
						`${this.state.currentIndex + 1} / ${this.state.findings.length}  ${finding.severity.toUpperCase()}  ${status}  ${finding.file}:${finding.startLine}`,
						contentWidth,
					),
				),
				0,
				0,
			),
		);
		content.addChild(new Text(this.theme.fg("accent", finding.title), 0, 0));
		content.addChild(new Spacer(1));
		content.addChild(new Text(finding.explanation, 0, 0));
		content.addChild(new Spacer(1));
		content.addChild(new Text(this.theme.fg("accent", "Suggested fix"), 0, 0));
		content.addChild(new Text(finding.suggestedFix, 0, 0));
		content.addChild(new Spacer(1));
		content.addChild(new Text(this.theme.fg("accent", "Source excerpt"), 0, 0));
		if (!excerpt.available) {
			content.addChild(new Text(this.theme.fg("dim", excerpt.message ?? "Source unavailable."), 0, 0));
		} else {
			for (const excerptLine of excerpt.lines) {
				const marker = excerptLine.selected ? ">" : " ";
				const lineText = truncateToWidth(
					`${marker} ${String(excerptLine.number).padStart(4, " ")}: ${excerptLine.text}`,
					contentWidth,
				);
				content.addChild(new Text(excerptLine.selected ? this.theme.fg("accent", lineText) : this.theme.fg("dim", lineText), 0, 0));
			}
		}
		return content;
	}

	private borderLine(width: number, left: string, fill: string, right: string): string {
		const safeWidth = Math.max(2, width);
		return this.theme.fg("accent", `${left}${fill.repeat(Math.max(0, safeWidth - 2))}${right}`);
	}

	private boxLine(width: number, text: string): string {
		const innerWidth = Math.max(0, width - 4);
		const clipped = truncateToWidth(text, innerWidth);
		const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)));
		return this.theme.fg("accent", `│ ${clipped}${padding} │`);
	}

	private scrollBy(delta: number): void {
		const bodyWidth = Math.max(20, Math.max(0, this.lastWidth - 4));
		const bodyLines = this.buildBodyContent(bodyWidth).render(bodyWidth);
		const maxScroll = Math.max(0, bodyLines.length - FINDINGS_VIEWPORT_LINES);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset + delta, maxScroll));
		this.invalidate();
	}

	private scrollToBottom(): void {
		const bodyWidth = Math.max(20, Math.max(0, this.lastWidth - 4));
		const bodyLines = this.buildBodyContent(bodyWidth).render(bodyWidth);
		this.scrollOffset = Math.max(0, bodyLines.length - FINDINGS_VIEWPORT_LINES);
		this.invalidate();
	}

	private buildFooterHint(canScroll: boolean): string {
		if (this.state.findings.length === 0) {
			return "Esc: close";
		}

		const scrollHint = canScroll ? "  Up/Down or j/k: scroll  PgUp/PgDn: page  Home/End: top/bottom" : "";
		return `f: fix  d: discard  s: submit${scrollHint}  Esc: close`;
	}
}

export async function showFindings(
	ctx: ExtensionCommandContext,
	state: ReviewRunState,
): Promise<FindingsDialogResult> {
	let latest = state;
	const result = await ctx.ui.custom<FindingsDialogResult>(
		(_tui, theme, _keybindings, done) =>
			new FindingsDialog(
				latest,
				ctx.cwd,
				theme,
				(updated) => {
					latest = updated.state;
					done(updated);
				},
				(stateToClose) => {
					const openCount = stateToClose.findings.length;
					return ctx.ui.confirm("Exit review?", `${openCount} finding${openCount === 1 ? "" : "s"} still retained.`);
				},
			),
		{ overlay: true, overlayOptions: { anchor: "center", width: "72%", minWidth: 72, maxHeight: "85%", margin: 2 } },
	);

	if (result && typeof result === "object" && "submitted" in result && "state" in result) {
		return result as FindingsDialogResult;
	}
	return { submitted: false, state: latest };
}
