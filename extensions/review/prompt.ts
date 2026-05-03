import type { ReviewFinding, SourceExcerpt } from "./findings.ts";
import type { ReviewTarget } from "./git.ts";

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

export function buildReviewFixPrompt(input: {
	targetLabel: string;
	findings: Array<{
		finding: ReviewFinding;
		sourceExcerpt: string;
	}>;
}): string {
	return [
		"You are now fixing the retained review findings.",
		"Make the code changes directly.",
		"Do not add new review findings unless you discover a blocker.",
		"Do not summarize; edit the code.",
		"",
		`Review target: ${input.targetLabel}`,
		"",
		"Findings to fix:",
		...input.findings.map(({ finding, sourceExcerpt }, index) => [
			`${index + 1}. [${finding.severity}] ${finding.file}:${finding.startLine}`,
			`Title: ${finding.title}`,
			`Why: ${finding.explanation}`,
			`Suggested fix: ${finding.suggestedFix}`,
			sourceExcerpt ? `Source:\n${sourceExcerpt}` : undefined,
			"",
		]
			.filter((part): part is string => part !== undefined)
			.join("\n")),
	].join("\n");
}
