import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { extractFindingsBlock, normalizeFindings } from "./findings.ts";
import type { ReviewTarget } from "./git.ts";
import { buildBaseReviewTarget, buildUncommittedReviewTarget, detectBaseRef, isGitRepository } from "./git.ts";
import { buildReviewPrompt } from "./prompt.ts";
import { REVIEW_STATE_ENTRY_TYPE, buildInitialReviewState } from "./state.ts";
import { chooseInitialMode, confirmPreflight, showFindings } from "./ui.ts";

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

function currentLeafId(ctx: ExtensionCommandContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	return (branch[branch.length - 1] as any)?.id;
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

			const baseRef = detectBaseRef(ctx.cwd) ?? (await ctx.ui.input("Base branch", "main"));
			if (!baseRef) {
				ctx.ui.notify("Review cancelled.", "info");
				return;
			}
			await runReview(ctx, buildBaseReviewTarget(ctx.cwd, baseRef));
		},
	});
}

async function runReview(ctx: ExtensionCommandContext, target: ReviewTarget): Promise<void> {
	if (!(await confirmPreflight(ctx, target))) {
		ctx.ui.notify("Review cancelled.", "info");
		return;
	}

	const leafId = currentLeafId(ctx);
	if (!leafId) {
		ctx.ui.notify("Cannot start review without a session leaf.", "error");
		return;
	}

	const prompt = buildReviewPrompt(target);
	const result = await ctx.fork(leafId, {
		position: "at",
		withSession: async (reviewCtx) => {
			await reviewCtx.sendUserMessage(prompt);
			await reviewCtx.waitForIdle();
			const output = lastAssistantText(reviewCtx);

			let findings;
			try {
				const parsed = extractFindingsBlock(output);
				findings = normalizeFindings(parsed.findings);
			} catch {
				reviewCtx.ui.notify("Could not parse review findings.", "error");
				return;
			}

			const state = buildInitialReviewState(target, findings, output);
			await reviewCtx.sendMessage({
				customType: REVIEW_STATE_ENTRY_TYPE,
				content: "",
				display: false,
				details: state,
			});
			const updated = await showFindings(reviewCtx, state);
			if (updated !== state) {
				await reviewCtx.sendMessage({
					customType: REVIEW_STATE_ENTRY_TYPE,
					content: "",
					display: false,
					details: updated,
				});
			}
		},
	});

	if (result.cancelled) {
		ctx.ui.notify("Review cancelled.", "info");
	}
}
