import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReviewFinding } from "../extensions/review/findings.ts";
import type { ReviewTarget } from "../extensions/review/git.ts";
import { buildReviewFixPrompt } from "../extensions/review/prompt.ts";
import { buildInitialReviewState } from "../extensions/review/state.ts";
import { FindingsDialog } from "../extensions/review/ui.ts";

const finding: ReviewFinding = {
	id: "finding-a",
	severity: "high",
	file: "src/a.ts",
	startLine: 10,
	endLine: 12,
	title: "Missing bounds check",
	explanation: "The index can exceed the array length.",
	suggestedFix: "Validate the index before reading the array.",
	status: "open",
};

const target: ReviewTarget = {
	mode: "uncommitted",
	label: "Uncommitted changes",
	promptContext: "diff",
	changedFiles: ["src/a.ts"],
	stagedCount: 1,
	unstagedCount: 0,
};

function makeSourceRoot(): string {
	const cwd = mkdtempSync(join(tmpdir(), "review-qna-"));
	mkdirSync(join(cwd, "src"), { recursive: true });
	writeFileSync(join(cwd, "src", "a.ts"), [
		"const one = 1;",
		"const two = 2;",
		"return items[index];",
	].join("\n"), "utf-8");
	return cwd;
}

describe("review triage", () => {
	it("builds a fix prompt for retained findings", () => {
		const prompt = buildReviewFixPrompt({
			targetLabel: "Local changes against main",
			findings: [{ finding: { ...finding, note: "Keep the API but make it safer." }, sourceExcerpt: "  2: const two = 2;\n> 3: return items[index];" }],
		});

		expect(prompt).toContain("You are now fixing the retained review findings.");
		expect(prompt).toContain("Missing bounds check");
		expect(prompt).toContain("Reviewer note: Keep the API but make it safer.");
		expect(prompt).toContain("Source:\n  2: const two = 2;\n> 3: return items[index];");
	});

	it("discards findings from the dialog and submits the remaining set", () => {
		const state = buildInitialReviewState(target, [finding], "raw output");
		let result: any;
		const dialog = new FindingsDialog(
			state,
			makeSourceRoot(),
			{ fg: (_role: string, text: string) => text } as never,
			(updated) => {
				result = updated;
			},
			async () => true,
		);

		dialog.handleInput("d");
		expect(dialog.render(100).join("\n")).toContain("No findings.");
		dialog.handleInput("s");
		expect(result).toEqual(expect.objectContaining({ submitted: true }));
		expect(result.state.findings).toHaveLength(0);
	});
});
