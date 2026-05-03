import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import type { ReviewFinding } from "./findings.ts";
import type { ReviewTarget } from "./git.ts";

export async function chooseInitialMode(ctx: ExtensionCommandContext): Promise<"uncommitted" | "base" | null> {
	const selected = await ctx.ui.select("Review target", ["Uncommitted changes", "Local changes against base"]);
	if (selected === "Uncommitted changes") return "uncommitted";
	if (selected === "Local changes against base") return "base";
	return null;
}

export function formatPreflight(target: ReviewTarget): string {
	return [
		`Target: ${target.label}`,
		target.baseRef ? `Base: ${target.baseRef}` : undefined,
		target.mergeBase ? `Merge base: ${target.mergeBase}` : undefined,
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

class FindingsDialog implements Component {
	private index = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly target: ReviewTarget,
		private readonly findings: ReviewFinding[],
		private readonly theme: Theme,
		private readonly done: (result: "closed") => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.done("closed");
			return;
		}
		if (this.findings.length === 0) return;
		if (matchesKey(data, Key.right) || data === "n") {
			this.index = Math.min(this.findings.length - 1, this.index + 1);
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.left) || data === "p") {
			this.index = Math.max(0, this.index - 1);
			this.invalidate();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const innerWidth = Math.max(20, width - 4);
		const lines: string[] = [];
		const push = (line = "") => lines.push(`| ${truncateToWidth(line, innerWidth).padEnd(innerWidth, " ")} |`);

		lines.push(`+${"-".repeat(innerWidth + 2)}+`);
		push(this.theme.fg("accent", "Code review findings"));
		push(this.theme.fg("dim", this.target.label));
		push();

		if (this.findings.length === 0) {
			push("No actionable findings found.");
			push();
			push("Esc: close");
		} else {
			const finding = this.findings[this.index]!;
			push(
				`${this.index + 1} / ${this.findings.length}  ${finding.severity.toUpperCase()}  ${finding.file}:${finding.startLine}`,
			);
			push(finding.title);
			push();
			for (const line of wrapTextWithAnsi(finding.explanation, innerWidth)) push(line);
			push();
			push("Suggested fix:");
			for (const line of wrapTextWithAnsi(finding.suggestedFix, innerWidth)) push(line);
			push();
			push("n/right: next  p/left: previous  Esc: close");
		}

		lines.push(`+${"-".repeat(innerWidth + 2)}+`);
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

export async function showFindings(
	ctx: ExtensionCommandContext,
	target: ReviewTarget,
	findings: ReviewFinding[],
): Promise<void> {
	await ctx.ui.custom<"closed">((_tui, theme, _keybindings, done) => new FindingsDialog(target, findings, theme, done), {
		overlay: true,
		overlayOptions: { width: "80%", minWidth: 60, maxHeight: "70%", anchor: "bottom-center", margin: 1 },
	});
}
