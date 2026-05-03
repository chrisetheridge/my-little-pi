import type { ReviewFinding, SourceExcerpt } from "./findings.ts";
import type { ReviewTarget } from "./git.ts";
import type { ReviewQnaTurn } from "./state.ts";

export function buildReviewPrompt(target: ReviewTarget): string {
	return [
		"You are performing code review only.",
		"Do not modify files. Do not apply patches. Do not write commits.",
		"Use tools only as needed to validate concrete review concerns.",
		"Return only actionable findings. Do not include looks-good notes.",
		"",
		"At the end of your response, include exactly one fenced block named review-findings.",
		"The block must be valid JSON with this shape:",
		"```review-findings",
		JSON.stringify(
			{
				summary: "Short summary. Use an empty string if there are findings and no extra summary is needed.",
				findings: [
					{
						id: "short-human-readable-id",
						severity: "critical|high|medium|low",
						file: "path/relative/to/repo",
						startLine: 1,
						startColumn: 1,
						endLine: 1,
						endColumn: 1,
						title: "Concise issue title",
						explanation: "Why this is a problem",
						suggestedFix: "Concrete remediation guidance",
					},
				],
			},
			null,
			2,
		),
		"```",
		"",
		"If there are no actionable findings, return findings as an empty array.",
		"",
		target.promptContext,
	].join("\n");
}

export function buildFindingsFormatterPrompt(rawOutput: string): string {
	return [
		"Convert this raw code review output into exactly one fenced review-findings block and no prose.",
		"Return only the fenced block.",
		"The block must contain valid JSON with this shape:",
		"```review-findings",
		JSON.stringify(
			{
				summary: "Short summary string.",
				findings: [
					{
						id: "optional-short-human-readable-id",
						severity: "critical|high|medium|low",
						file: "path/relative/to/repo",
						startLine: 1,
						startColumn: 1,
						endLine: 1,
						endColumn: 1,
						title: "Concise issue title",
						explanation: "Why this is a problem",
						suggestedFix: "Concrete remediation guidance",
					},
				],
			},
			null,
			2,
		),
		"```",
		"Preserve only actionable findings. If there are no actionable findings, use an empty findings array.",
		"Do not invent findings that are not supported by the raw review output.",
		"",
		"Raw review output:",
		rawOutput,
	].join("\n");
}

export function formatExcerptForPrompt(excerpt: SourceExcerpt): string {
	if (!excerpt.available) return excerpt.message ?? "Source unavailable.";
	return excerpt.lines.map((line) => `${line.selected ? ">" : " "} ${line.number}: ${line.text}`).join("\n");
}

export function buildQnaPrompt(input: {
	finding: ReviewFinding;
	targetLabel: string;
	sourceExcerpt: string;
	priorTurns: ReviewQnaTurn[];
	question: string;
}): string {
	const prior = input.priorTurns.length
		? input.priorTurns.map((turn) => `Q: ${turn.question}\nA: ${turn.answer}`).join("\n\n")
		: "No prior Q&A for this finding.";
	return [
		"Answer only about this selected finding. Do not perform a new review and do not create new findings.",
		`Review target: ${input.targetLabel}`,
		"",
		`Finding: ${input.finding.title}`,
		`Severity: ${input.finding.severity}`,
		`Location: ${input.finding.file}:${input.finding.startLine}`,
		`Explanation: ${input.finding.explanation}`,
		`Suggested fix: ${input.finding.suggestedFix}`,
		"",
		"Source excerpt:",
		input.sourceExcerpt,
		"",
		"Prior Q&A:",
		prior,
		"",
		`User question: ${input.question}`,
	].join("\n");
}
