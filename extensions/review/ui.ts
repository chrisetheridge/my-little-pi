import { complete, type AssistantMessage, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import { loadSourceExcerpt } from "./findings.ts";
import type { ReviewTarget } from "./git.ts";
import { buildQnaPrompt, formatExcerptForPrompt } from "./prompt.ts";
import { addQnaTurn, updateFindingStatus, updateReviewIndex, type ReviewRunState } from "./state.ts";

const QNA_SYSTEM_PROMPT = "You answer focused questions about one code review finding.";

export function qnaAnswerFromResponse(
	response: Pick<AssistantMessage, "stopReason" | "content" | "errorMessage">,
): { ok: true; answer: string } | { ok: false; message: string } {
	if (response.stopReason !== "stop") {
		return {
			ok: false,
			message: `Could not answer finding question: ${response.errorMessage ?? `model stopped with ${response.stopReason}.`}`,
		};
	}

	const answer = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();

	if (!answer) {
		return { ok: false, message: "Could not answer finding question: empty response." };
	}
	return { ok: true, answer };
}

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

export class FindingsDialog implements Component {
	private state: ReviewRunState;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private asking = false;
	private activeQnaAbort?: AbortController;
	private closeAfterQnaAbort = false;

	constructor(
		state: ReviewRunState,
		private readonly theme: Theme,
		private readonly done: (result: ReviewRunState) => void,
		private readonly askQuestion: (
			state: ReviewRunState,
			findingId: string,
			signal: AbortSignal,
		) => Promise<ReviewRunState | undefined>,
	) {
		const maxIndex = Math.max(0, state.findings.length - 1);
		this.state =
			state.currentIndex < 0 || state.currentIndex > maxIndex ? updateReviewIndex(state, state.currentIndex) : state;
	}

	handleInput(data: string): void {
		if (this.asking) {
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
				this.closeAfterQnaAbort = true;
				this.activeQnaAbort?.abort();
			}
			return;
		}
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.done(this.state);
			return;
		}
		if (this.state.findings.length === 0) return;
		if (matchesKey(data, Key.right) || data === "n") {
			this.state = updateReviewIndex(this.state, this.state.currentIndex + 1);
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.left) || data === "p") {
			this.state = updateReviewIndex(this.state, this.state.currentIndex - 1);
			this.invalidate();
			return;
		}
		if (data === "i") {
			const finding = this.state.findings[this.state.currentIndex];
			if (!finding) return;
			this.state = updateFindingStatus(this.state, finding.id, "ignored");
			this.invalidate();
			return;
		}
		if (data === "q") {
			const finding = this.state.findings[this.state.currentIndex];
			if (!finding) return;
			this.asking = true;
			this.closeAfterQnaAbort = false;
			this.activeQnaAbort = new AbortController();
			this.invalidate();
			this.askQuestion(this.state, finding.id, this.activeQnaAbort.signal)
				.then((updated) => {
					if (updated) {
						this.state = updateReviewIndex(updated, this.state.currentIndex);
					}
				})
				.catch(() => undefined)
				.finally(() => {
					this.asking = false;
					this.activeQnaAbort = undefined;
					this.invalidate();
					if (this.closeAfterQnaAbort) {
						this.closeAfterQnaAbort = false;
						this.done(this.state);
					}
				});
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const innerWidth = Math.max(20, width - 4);
		const lines: string[] = [];
		const push = (line = "") => lines.push(`| ${truncateToWidth(line, innerWidth).padEnd(innerWidth, " ")} |`);

		lines.push(`+${"-".repeat(innerWidth + 2)}+`);
		push(this.theme.fg("accent", "Code review findings"));
		push(this.theme.fg("dim", this.state.target.label));
		push();

		if (this.state.findings.length === 0) {
			push("No actionable findings found.");
			push();
			push("Esc: close");
		} else {
			const finding = this.state.findings[this.state.currentIndex]!;
			const status = finding.status === "ignored" ? "  IGNORED" : "";
			push(
				`${this.state.currentIndex + 1} / ${this.state.findings.length}  ${finding.severity.toUpperCase()}${status}  ${finding.file}:${finding.startLine}`,
			);
			push(finding.title);
			push();
			for (const line of wrapTextWithAnsi(finding.explanation, innerWidth)) push(line);
			push();
			push("Suggested fix:");
			for (const line of wrapTextWithAnsi(finding.suggestedFix, innerWidth)) push(line);
			push();
			const qnaTurns = this.state.qnaByFindingId[finding.id] ?? [];
			if (qnaTurns.length) {
				push(`Q&A turns: ${qnaTurns.length}`);
				push();
			}
			push(`n/right: next  p/left: previous  i: ignore  q: ask${this.asking ? "..." : ""}  Esc: close`);
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
	state: ReviewRunState,
): Promise<ReviewRunState> {
	let latest = state;
	const askQuestion = async (
		currentState: ReviewRunState,
		findingId: string,
		signal: AbortSignal,
	): Promise<ReviewRunState | undefined> => {
		latest = currentState;
		const question = (await ctx.ui.input("Ask about this finding", ""))?.trim();
		if (!question) return undefined;
		if (signal.aborted) return undefined;
		const finding = currentState.findings.find((item) => item.id === findingId);
		if (!finding) return undefined;
		if (!ctx.model) {
			ctx.ui.notify("Select a model before asking about a finding.", "error");
			return undefined;
		}

		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (!auth.ok || !auth.apiKey) {
			ctx.ui.notify(auth.ok ? `No API key for ${ctx.model.provider}` : auth.error, "error");
			return undefined;
		}
		if (signal.aborted) return undefined;

		const excerpt = loadSourceExcerpt(ctx.cwd, finding);
		const userMessage: UserMessage = {
			role: "user",
			content: [{
				type: "text",
				text: buildQnaPrompt({
					finding,
					targetLabel: currentState.target.label,
					sourceExcerpt: formatExcerptForPrompt(excerpt),
					priorTurns: currentState.qnaByFindingId[finding.id] ?? [],
					question,
				}),
			}],
			timestamp: Date.now(),
		};

		try {
			const response = await complete(
				ctx.model,
				{ systemPrompt: QNA_SYSTEM_PROMPT, messages: [userMessage] },
				{ apiKey: auth.apiKey, headers: auth.headers, signal },
			);
			if (signal.aborted) return undefined;
			const answer = qnaAnswerFromResponse(response);
			if (!answer.ok) {
				if (response.stopReason !== "aborted") ctx.ui.notify(answer.message, "error");
				return undefined;
			}
			latest = addQnaTurn(currentState, finding.id, { question, answer: answer.answer, timestamp: Date.now() });
			return latest;
		} catch (error) {
			if (signal.aborted) return undefined;
			ctx.ui.notify(`Could not answer finding question: ${(error as Error).message}`, "error");
			return undefined;
		}
	};
	const result = await ctx.ui.custom<ReviewRunState>(
		(_tui, theme, _keybindings, done) => new FindingsDialog(latest, theme, (updated) => {
			latest = updated;
			done(updated);
		}, askQuestion),
		{
			overlay: true,
			overlayOptions: { width: "80%", minWidth: 60, maxHeight: "70%", anchor: "bottom-center", margin: 1 },
		},
	);

	if (latest !== state) return latest;
	if (result?.kind === "review-state") return result;
	return latest;
}
