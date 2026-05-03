import { complete, type AssistantMessage, type UserMessage } from "@mariozechner/pi-ai";
import { DynamicBorder, type ExtensionCommandContext, type Theme } from "@mariozechner/pi-coding-agent";
import { Box, Container, Input, Key, matchesKey, Spacer, Text, truncateToWidth, type Focusable } from "@mariozechner/pi-tui";
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
	const selected = await ctx.ui.select([
		"Review findings parse failed.",
		"",
		error.message,
		"",
		"Raw output preview:",
		preview || "(empty output)",
	].join("\n"), [
		"Retry extraction",
		"Cancel",
	]);
	return selected === "Retry extraction" ? "retry" : "cancel";
}

export class FindingsDialog {
	private state: ReviewRunState;
	private asking = false;
	private activeQnaAbort?: AbortController;
	private closeAfterQnaAbort = false;
	private statusMessage?: string;

	constructor(
		state: ReviewRunState,
		private readonly cwd: string,
		private readonly theme: Theme,
		private readonly done: (result: ReviewRunState) => void,
		private readonly confirmClose: (state: ReviewRunState) => Promise<boolean>,
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
			const hasOpenFindings = this.state.findings.some((finding) => finding.status === "open");
			if (!hasOpenFindings) {
				this.done(this.state);
				return;
			}
			this.statusMessage = "Confirming close with open findings...";
			this.invalidate();
			this.confirmClose(this.state)
				.then((confirmed) => {
					if (confirmed) {
						this.done(this.state);
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
			this.statusMessage = undefined;
			this.invalidate();
			return;
		}
		if (data === "a") {
			this.statusMessage = "Actions are not designed yet.";
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
		return this.buildView(width).render(width);
	}

	invalidate(): void {
		// No cached render state to clear.
	}

	private buildView(width: number): Container {
		const root = new Container();
		const accentBorder = () => new DynamicBorder((text: string) => this.theme.fg("accent", text));
		const body = new Box(1, 1, (text: string) => this.decorateBody(text));
		const contentWidth = Math.max(20, width - 8);

		root.addChild(accentBorder());
		root.addChild(new Spacer(1));
		root.addChild(new Text(this.theme.fg("accent", "Code review findings"), 1, 0));
		root.addChild(new Text(this.theme.fg("muted", this.state.target.label), 1, 0));
		if (this.statusMessage) {
			root.addChild(new Text(this.theme.fg("dim", this.statusMessage), 1, 0));
		}
		root.addChild(new Spacer(1));

		body.addChild(this.buildBodyContent(contentWidth));
		root.addChild(body);
		root.addChild(new Spacer(1));
		root.addChild(new Text(this.theme.fg("dim", truncateToWidth(this.buildFooterHint(), contentWidth)), 1, 0));
		root.addChild(new Spacer(1));
		root.addChild(accentBorder());
		return root;
	}

	private buildBodyContent(contentWidth: number): Container {
		const content = new Container();

		if (this.state.findings.length === 0) {
			content.addChild(new Text("No actionable findings found.", 0, 0));
			return content;
		}

		const finding = this.state.findings[this.state.currentIndex]!;
		const excerpt = loadSourceExcerpt(this.cwd, finding);
		const qnaTurns = this.state.qnaByFindingId[finding.id] ?? [];
		const status = finding.status === "ignored" ? "IGNORED" : "OPEN";

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
		if (qnaTurns.length) {
			content.addChild(new Spacer(1));
			content.addChild(new Text(this.theme.fg("accent", `Questions & answers (${qnaTurns.length})`), 0, 0));
			for (const turn of qnaTurns) {
				content.addChild(new Text(`Q: ${turn.question}`, 0, 0));
				content.addChild(new Text(this.theme.fg("dim", `A: ${turn.answer}`), 0, 0));
			}
		}
		return content;
	}

	private decorateBody(text: string): string {
		const bg = (this.theme as { bg?: (role: string, value: string) => string }).bg;
		return typeof bg === "function" ? bg.call(this.theme, "customMessageBg", text) : text;
	}

	private buildFooterHint(): string {
		if (this.state.findings.length === 0) {
			return "Esc: close";
		}

		return `n/right: next  p/left: previous  i: ignore  q: ask${this.asking ? "..." : ""}  a: actions unavailable  Esc: close`;
	}
}

class QuestionDialog extends Container implements Focusable {
	private readonly input: Input;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.input.focused = value;
	}

	constructor(
		private readonly theme: Theme,
		title: string,
		prompt: string,
		prefill = "",
		private readonly onSubmit: (value: string) => void,
		private readonly onCancel: () => void,
	) {
		super();
		this.input = new Input();
		this.input.setValue(prefill);

		this.addChild(new DynamicBorder((text: string) => this.theme.fg("accent", text)));
		this.addChild(new Text(this.theme.fg("accent", title), 1, 0));
		this.addChild(new Text(this.theme.fg("muted", prompt), 1, 0));
		this.addChild(new Spacer(1));
		const inputBox = new Box(1, 1, (text: string) => this.decorateBody(text));
		inputBox.addChild(this.input);
		this.addChild(inputBox);
		this.addChild(new Spacer(1));
		this.addChild(new Text(this.theme.fg("dim", "Enter: submit  Esc: cancel"), 1, 0));
		this.addChild(new DynamicBorder((text: string) => this.theme.fg("accent", text)));
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.onCancel();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.onSubmit(this.input.getValue().trim());
			return;
		}
		this.input.handleInput(data);
	}

	private decorateBody(text: string): string {
		const bg = (this.theme as { bg?: (role: string, value: string) => string }).bg;
		return typeof bg === "function" ? bg.call(this.theme, "customMessageBg", text) : text;
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
		const finding = currentState.findings.find((item) => item.id === findingId);
		if (!finding) return undefined;
		const question = await ctx.ui.custom<string | null>(
			(_tui, theme, _keybindings, done) =>
				new QuestionDialog(
					theme,
					"Ask about this finding",
					[
						`${finding.file}:${finding.startLine}`,
						finding.title,
						"",
						"Ask a focused question about this finding.",
					].join("\n"),
					"",
					(value) => done(value || null),
					() => done(null),
				),
			{
				overlay: true,
				overlayOptions: { anchor: "center", width: "60%", minWidth: 54, maxHeight: 16, margin: 2 },
			},
		);
		const trimmedQuestion = question?.trim();
		if (!trimmedQuestion) return undefined;
		if (signal.aborted) return undefined;
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
					question: trimmedQuestion,
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
			latest = addQnaTurn(currentState, finding.id, { question: trimmedQuestion, answer: answer.answer, timestamp: Date.now() });
			return latest;
		} catch (error) {
			if (signal.aborted) return undefined;
			ctx.ui.notify(`Could not answer finding question: ${(error as Error).message}`, "error");
			return undefined;
		}
	};
	const result = await ctx.ui.custom<ReviewRunState>(
		(_tui, theme, _keybindings, done) =>
			new FindingsDialog(
				latest,
				ctx.cwd,
				theme,
				(updated) => {
					latest = updated;
					done(updated);
				},
				(stateToClose) => {
					const openCount = stateToClose.findings.filter((finding) => finding.status === "open").length;
					return ctx.ui.confirm("Exit review?", `${openCount} finding${openCount === 1 ? "" : "s"} still open.`);
				},
				askQuestion,
			),
		{
			overlay: true,
			overlayOptions: { width: "84%", minWidth: 72, maxHeight: "78%", anchor: "center", margin: 2 },
		},
	);

	if (latest !== state) return latest;
	if (result?.kind === "review-state") return result;
	return latest;
}
