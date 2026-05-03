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
