import { complete, type AssistantMessage, type UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { extractFindingsBlock, loadSourceExcerpt, normalizeFindings } from "./findings.ts";
import type { ReviewTarget } from "./git.ts";
import {
	buildBaseReviewTarget,
	buildCommitReviewTarget,
	buildPullRequestReviewTarget,
	buildUncommittedReviewTarget,
	detectBaseRef,
	getCurrentRef,
	isGitRepository,
	restoreOriginalRef,
} from "./git.ts";
import { buildFindingsFormatterPrompt, buildReviewFixPrompt, buildReviewPrompt, formatExcerptForPrompt } from "./prompt.ts";
import { buildInitialReviewState } from "./state.ts";
import { chooseInitialMode, confirmPreflight, showFindings, showParseRecovery } from "./ui.ts";

function lastAssistantText(ctx: Pick<ExtensionCommandContext, "sessionManager">): string {
	const branch = ctx.sessionManager.getBranch();

	for (let i = branch.length - 1; i >= 0; i -= 1) {
		const entry = branch[i] as any;
		if (entry.type !== "message" || entry.message?.role !== "assistant") continue;

		return (entry.message.content ?? [])
			.filter((part: any) => part.type === "text" && typeof part.text === "string")
			.map((part: any) => part.text)
			.join("\n");
	}

	return "";
}

function assistantText(response: Pick<AssistantMessage, "content">): string {
	return response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

export async function formatFindingsWithSelectedModel(
	ctx: ExtensionCommandContext,
	rawOutput: string,
): Promise<string> {
	if (!ctx.model) {
		throw new Error("Select a model before retrying findings extraction.");
	}

	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
	if (!auth.ok || !auth.apiKey) {
		throw new Error(auth.ok ? `No API key for ${ctx.model.provider}` : auth.error);
	}

	const userMessage: UserMessage = {
		role: "user",
		content: [{ type: "text", text: buildFindingsFormatterPrompt(rawOutput) }],
		timestamp: Date.now(),
	};
	const response = await complete(
		ctx.model,
		{ messages: [userMessage] },
		{ apiKey: auth.apiKey, headers: auth.headers },
	);
	if (response.stopReason !== "stop") {
		throw new Error(response.errorMessage ?? `formatter model stopped with ${response.stopReason}.`);
	}

	const output = assistantText(response).trim();
	if (!output) {
		throw new Error("formatter model returned an empty response.");
	}
	return output;
}

export default function reviewExtension(pi: ExtensionAPI): void {
	pi.registerCommand("review", {
		description: "Start a structured code review flow",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/review requires interactive mode", "error");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("Select a model before running /review.", "error");
				return;
			}
			if (!isGitRepository(ctx.cwd)) {
				ctx.ui.notify("/review requires a git repository.", "error");
				return;
			}

			const mode = await chooseInitialMode(ctx);
			if (!mode) {
				ctx.ui.notify("Review cancelled.", "info");
				return;
			}

			if (mode === "uncommitted") {
				await runReview(ctx, buildUncommittedReviewTarget(ctx.cwd));
				return;
			}

			if (mode === "base") {
				const baseRef = detectBaseRef(ctx.cwd) ?? (await ctx.ui.input("Base branch", "main"));
				if (!baseRef) {
					ctx.ui.notify("Review cancelled.", "info");
					return;
				}
				await runReview(ctx, buildBaseReviewTarget(ctx.cwd, baseRef));
				return;
			}

			if (mode === "commit") {
				const commitRef = (await ctx.ui.input("Commit ref", "HEAD"))?.trim();
				if (!commitRef) {
					ctx.ui.notify("Review cancelled.", "info");
					return;
				}
				await runReview(ctx, buildCommitReviewTarget(ctx.cwd, commitRef));
				return;
			}

			if (mode === "pr") {
				const prUrl = (await ctx.ui.input("Pull request URL", ""))?.trim();
				if (!prUrl) {
					ctx.ui.notify("Review cancelled.", "info");
					return;
				}
				const originalRef = getCurrentRef(ctx.cwd);
				let target: ReviewTarget;
				try {
					target = buildPullRequestReviewTarget(ctx.cwd, prUrl, undefined, originalRef);
				} catch (error) {
					if (!restoreOriginalRef(ctx.cwd, originalRef)) {
						ctx.ui.notify(`Failed to restore original git ref ${originalRef}.`, "error");
					}
					throw error;
				}
				await runReview(ctx, target);
			}
		},
	});
}

async function runReview(ctx: ExtensionCommandContext, target: ReviewTarget): Promise<void> {
	const cwd = ctx.cwd;
	const originalRef = target.originalRef;
	if (!(await confirmPreflight(ctx, target))) {
		ctx.ui.notify("Review cancelled.", "info");
		return;
	}

	const prompt = buildReviewPrompt(target);
	let restoreAttempted = false;
	await ctx.newSession({
		withSession: async (reviewCtx) => {
			try {
				await reviewCtx.sendUserMessage(prompt);
				await reviewCtx.waitForIdle();
				const output = lastAssistantText(reviewCtx);

				let findings;
				try {
					const parsed = extractFindingsBlock(output);
					findings = normalizeFindings(parsed.findings);
				} catch (error) {
					const choice = await showParseRecovery(reviewCtx, error as Error, output);
					if (choice === "cancel") {
						reviewCtx.ui.notify("Review cancelled.", "info");
						return;
					}

					try {
						const formatterOutput = await formatFindingsWithSelectedModel(reviewCtx, output);
						const parsed = extractFindingsBlock(formatterOutput);
						findings = normalizeFindings(parsed.findings);
					} catch (formatterError) {
						reviewCtx.ui.notify(`Could not recover review findings: ${(formatterError as Error).message}`, "error");
						return;
					}
				}

				const state = buildInitialReviewState(target, findings, output);
				const result = await showFindings(reviewCtx, state);
				if (!result.submitted) return;
				if (result.state.findings.length === 0) {
					reviewCtx.ui.notify("no findings", "info");
					return;
				}

				const fixPrompt = buildReviewFixPrompt({
					targetLabel: target.label,
					findings: result.state.findings.map((finding) => ({
						finding,
						sourceExcerpt: formatExcerptForPrompt(loadSourceExcerpt(cwd, finding)),
					})),
				});

				await reviewCtx.newSession({
					withSession: async (fixCtx) => {
						await fixCtx.sendUserMessage(fixPrompt);
						await fixCtx.waitForIdle();
					},
				});
			} finally {
				if (originalRef && !restoreAttempted) {
					restoreAttempted = true;
					if (!restoreOriginalRef(cwd, originalRef)) {
						reviewCtx.ui.notify(`Failed to restore original git ref ${originalRef}.`, "error");
					}
				}
			}
		},
	});
}
