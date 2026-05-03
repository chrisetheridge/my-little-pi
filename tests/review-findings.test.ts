import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	extractFindingsBlock,
	loadSourceExcerpt,
	normalizeFindings,
} from "../extensions/review/findings.ts";

describe("review findings", () => {
	it("extracts a fenced review-findings JSON block", () => {
		const parsed = extractFindingsBlock([
			"Review complete.",
			"",
			"```review-findings",
			JSON.stringify({
				summary: "Two issues found.",
				findings: [
					{
						severity: "HIGH",
						file: "src/a.ts",
						startLine: 3,
						title: "Problem",
						explanation: "This can fail.",
						suggestedFix: "Guard it.",
					},
				],
			}),
			"```",
		].join("\n"));

		expect(parsed.summary).toBe("Two issues found.");
		expect(parsed.findings).toHaveLength(1);
		expect(parsed.findings[0]?.title).toBe("Problem");
	});

	it("throws when the review-findings block is missing", () => {
		expect(() => extractFindingsBlock("```json\n{}\n```")).toThrow(
			"Missing ```review-findings fenced block.",
		);
		expect(() => extractFindingsBlock("plain markdown")).toThrow(
			"Missing ```review-findings fenced block.",
		);
	});

	it("normalizes severity, paths, status, and deterministic ids", () => {
		const findings = normalizeFindings([
			{
				severity: "CRITICAL",
				file: "./src/a.ts",
				startLine: 7,
				startColumn: 2,
				endLine: 8,
				endColumn: 4,
				title: "  Escalates privileges ",
				explanation: " User input is trusted. ",
				suggestedFix: " Validate the role. ",
			},
			{
				severity: "surprising",
				file: "src/b.ts",
				startLine: 1,
				title: "Fallback severity",
				explanation: "Unknown severities should not leak through.",
				suggestedFix: "Default to medium.",
			},
		]);
		const repeated = normalizeFindings([
			{
				severity: "critical",
				file: "src/a.ts",
				startLine: 7,
				startColumn: 2,
				endLine: 8,
				endColumn: 4,
				title: "Escalates privileges",
				explanation: "User input is trusted.",
				suggestedFix: "Validate the role.",
			},
		]);

		expect(findings[0]).toEqual({
			id: expect.stringMatching(/^finding-/),
			severity: "critical",
			file: "src/a.ts",
			startLine: 7,
			startColumn: 2,
			endLine: 8,
			endColumn: 4,
			title: "Escalates privileges",
			explanation: "User input is trusted.",
			suggestedFix: "Validate the role.",
			status: "open",
		});
		expect(findings[0]?.id).toBe(repeated[0]?.id);
		expect(findings[1]?.severity).toBe("medium");
	});

	it("validates required fields and source locations", () => {
		expect(() => normalizeFindings([
			{
				severity: "low",
				file: "../outside.ts",
				startLine: 1,
				title: "Bad path",
				explanation: "Outside paths are not allowed.",
				suggestedFix: "Use a workspace-relative path.",
			},
		])).toThrow("file");

		expect(() => normalizeFindings([
			{
				severity: "low",
				file: "src/a.ts",
				startLine: 2,
				endLine: 1,
				title: "Bad range",
				explanation: "The range is reversed.",
				suggestedFix: "Fix the line range.",
			},
		])).toThrow("endLine");

		expect(() => normalizeFindings([
			{
				severity: "low",
				file: "src/a.ts",
				startLine: 1,
				title: " ",
				explanation: "Missing title.",
				suggestedFix: "Add a title.",
			},
		])).toThrow("title");
	});

	it("throws a controlled error when a finding entry is not an object", () => {
		expect(() => normalizeFindings([null as any])).toThrow(
			"Finding at index 0 must be an object.",
		);
	});

	it("throws a controlled error when an optional string field has the wrong type", () => {
		expect(() => normalizeFindings([
			{
				severity: 5,
				file: "a.ts",
				startLine: 1,
				title: "t",
				explanation: "e",
				suggestedFix: "f",
			} as any,
		])).toThrow("Finding severity must be a string.");
	});

	it("throws a controlled error when an optional numeric field has the wrong type", () => {
		expect(() => normalizeFindings([
			{
				severity: "low",
				file: "a.ts",
				startLine: 1,
				startColumn: "2",
				title: "t",
				explanation: "e",
				suggestedFix: "f",
			} as any,
		])).toThrow("Finding startColumn must be a number.");
	});

	it("loads a bounded source excerpt with selected line markers", () => {
		const cwd = mkdtempSync(join(tmpdir(), "review-findings-"));
		mkdirSync(join(cwd, "src"));
		writeFileSync(join(cwd, "src", "a.ts"), [
			"line 1",
			"line 2",
			"line 3",
			"line 4",
			"line 5",
			"line 6",
		].join("\n"), "utf-8");

		const excerpt = loadSourceExcerpt(cwd, {
			file: "./src/a.ts",
			startLine: 3,
			endLine: 4,
		}, 1);

		expect(excerpt.available).toBe(true);
		expect(excerpt.lines).toEqual([
			{ number: 2, text: "line 2", selected: false },
			{ number: 3, text: "line 3", selected: true },
			{ number: 4, text: "line 4", selected: true },
			{ number: 5, text: "line 5", selected: false },
		]);
	});

	it("reports unavailable source for missing, outside, and out-of-range locations", () => {
		const cwd = mkdtempSync(join(tmpdir(), "review-findings-"));
		mkdirSync(join(cwd, "src"));
		writeFileSync(join(cwd, "src", "a.ts"), "one\n", "utf-8");

		expect(loadSourceExcerpt(cwd, {
			file: "src/missing.ts",
			startLine: 1,
		}).available).toBe(false);
		expect(loadSourceExcerpt(cwd, {
			file: "../outside.ts",
			startLine: 1,
		}).message).toContain("outside");
		expect(loadSourceExcerpt(cwd, {
			file: "src/a.ts",
			startLine: 3,
		}).message).toContain("out of range");
	});
});
