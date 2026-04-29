import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

interface ExtractedQuestion {
	question: string;
	context?: string;
}

interface AnswerRecord {
	question: string;
	context?: string;
	answer: string;
}

const ANSWER_CUSTOM_TYPE = "answer";
const SENTENCE_SPLIT_RE = /(?<=[.?!])\s+/;

function cleanTextBlock(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, "\n")
		.replace(/`[^`]*`/g, "")
		.replace(/\r\n/g, "\n");
}

function normalizeQuestion(text: string): string {
	return text
		.replace(/^[-*•]\s*/, "")
		.replace(/^\s*Q:\s*/i, "")
		.replace(/\s+/g, " ")
		.trim();
}

export function extractQuestionsFromText(text: string): ExtractedQuestion[] {
	const cleaned = cleanTextBlock(text).trim();
	const matches = new Set<string>();
	const questions: ExtractedQuestion[] = [];

	const pushMatch = (raw: string): void => {
		const question = normalizeQuestion(raw);
		if (!question || question.length < 2) return;
		if (matches.has(question.toLowerCase())) return;
		matches.add(question.toLowerCase());
		questions.push({ question });
	};

	for (const segment of cleaned.split(SENTENCE_SPLIT_RE)) {
		const normalized = segment.replace(/^[-*•]\s*/, "").trim();
		if (!normalized.endsWith("?")) continue;
		pushMatch(normalized);
	}

	return questions;
}

export function getLastAssistantText(entries: Array<any>): string | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (!entry || entry.type !== "message") continue;
		const message = entry.message;
		if (!message || message.role !== "assistant") continue;

		const content = message.content;
		if (typeof content === "string" && content.trim()) {
			return content.trim();
		}

		if (Array.isArray(content)) {
			const textParts = content
				.filter((block: any) => block && block.type === "text" && typeof block.text === "string")
				.map((block: any) => block.text.trim())
				.filter((text: string) => text.length > 0);
			if (textParts.length > 0) {
				return textParts.join("\n");
			}
		}
	}

	return null;
}

async function collectAnswers(ctx: ExtensionContext, questions: ExtractedQuestion[]): Promise<AnswerRecord[] | null> {
	const answers: AnswerRecord[] = [];

	for (let index = 0; index < questions.length; index++) {
		const question = questions[index];
		if (!question) continue;

		if (ctx.hasUI) {
			ctx.ui.notify(`Question ${index + 1}/${questions.length}: ${question.question}`, "info");
		}

		const answer = await ctx.ui.editor(`Answer ${index + 1}/${questions.length}`, "");
		if (answer === undefined) {
			return null;
		}

		answers.push({
			question: question.question,
			context: question.context,
			answer: answer.trim(),
		});
	}

	return answers;
}

function formatAnswerMessage(records: AnswerRecord[]): string {
	const parts: string[] = ["I answered the questions below:"];
	for (const record of records) {
		parts.push("");
		parts.push(`Q: ${record.question}`);
		if (record.context) {
			parts.push(`> ${record.context}`);
		}
		parts.push(`A: ${record.answer || "(no answer)"}`);
	}
	return parts.join("\n");
}

async function runAnswerFlow(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	const lastAssistantText = getLastAssistantText(ctx.sessionManager.getEntries());
	if (!lastAssistantText) {
		ctx.ui.notify("No assistant message found to answer.", "warning");
		return;
	}

	const questions = extractQuestionsFromText(lastAssistantText);
	if (questions.length === 0) {
		ctx.ui.notify("No questions found in the last assistant message.", "info");
		return;
	}

	if (!ctx.hasUI) {
		ctx.ui.notify("Answer mode requires an interactive UI.", "warning");
		return;
	}

	ctx.ui.notify(`Found ${questions.length} question${questions.length === 1 ? "" : "s"}.`, "info");

	const answers = await collectAnswers(ctx, questions);
	if (!answers) {
		ctx.ui.notify("Cancelled.", "info");
		return;
	}

	await pi.sendMessage(
		{
			customType: ANSWER_CUSTOM_TYPE,
			content: formatAnswerMessage(answers),
			display: true,
		},
		{ triggerTurn: true },
	);
}

export default function answerExtension(pi: ExtensionAPI): void {
	const handler = async (_args: string, ctx: ExtensionContext): Promise<void> => {
		await runAnswerFlow(pi, ctx);
	};

	pi.registerCommand("answer", {
		description: "Answer questions from the last assistant message",
		handler,
	});

	pi.registerCommand("plan", {
		description: "Answer questions from the last assistant message while planning",
		handler,
	});

	pi.registerShortcut("ctrl+.", {
		description: "Answer questions from the last assistant message",
		handler: async (ctx) => runAnswerFlow(pi, ctx),
	});
}
