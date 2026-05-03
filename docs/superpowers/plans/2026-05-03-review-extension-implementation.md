# Review Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/review` extension as six shippable slices: target selection, structured findings, blocking navigation, persistence, Q&A, commit review, PR checkout review, and recovery/action polish.

**Architecture:** The extension is command-owned and blocking: `/review` prepares a target, sends a normal Pi review turn in a fresh branch/session context, parses structured findings, then opens a custom TUI navigator. Runtime code stays under `extensions/review/`; tests stay at repo root so Pi does not auto-discover tests as extensions.

**Tech Stack:** TypeScript, Pi extension APIs from `@mariozechner/pi-coding-agent`, TUI components from `@mariozechner/pi-tui`, Node `child_process`/`fs`/`path`, Vitest.

---

## File Structure

- Create `extensions/review/index.ts`: extension entry point, `/review` registration, high-level orchestration.
- Create `extensions/review/git.ts`: read-only git helpers and review target resolution.
- Create `extensions/review/findings.ts`: finding schema, JSON extraction, validation, stable ID normalization, source excerpt loading.
- Create `extensions/review/prompt.ts`: review and Q&A prompt builders.
- Create `extensions/review/state.ts`: durable review state types and append/rebuild helpers.
- Create `extensions/review/ui.ts`: blocking TUI components for target preflight, findings navigation, recovery, and Q&A.
- Modify `package.json`: add `./extensions/review/index.ts` to `pi.extensions`.
- Create root tests:
  - `review-git.test.ts`
  - `review-findings.test.ts`
  - `review-extension.test.ts`
  - `review-state.test.ts`
  - `review-qna.test.ts`
  - `review-pr.test.ts`

Use tabs for indentation in new TypeScript runtime files if surrounding extension files use tabs; keep test files consistent with existing Vitest style.

---

## Slice 1: Uncommitted/Base Review, Parsing, Basic Navigator

### Task 1: Register `/review` and wire package discovery

**Files:**
- Create: `extensions/review/index.ts`
- Modify: `package.json`
- Test: `review-extension.test.ts`

- [ ] **Step 1: Write the failing registration test**

Create `review-extension.test.ts` with:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.restoreAllMocks();
	vi.resetModules();
});

function makePi() {
	const commands = new Map<string, any>();
	const pi = {
		registerCommand: vi.fn((name: string, options: any) => {
			commands.set(name, options);
		}),
	};
	return { pi, commands };
}

describe("review extension", () => {
	it("registers the review command", async () => {
		const { pi, commands } = makePi();
		const { default: reviewExtension } = await import("./extensions/review/index.ts");

		reviewExtension(pi as never);

		expect(commands.has("review")).toBe(true);
		expect(commands.get("review")?.description).toContain("code review");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- review-extension.test.ts`

Expected: FAIL because `./extensions/review/index.ts` does not exist.

- [ ] **Step 3: Implement the minimal extension entry point**

Create `extensions/review/index.ts`:

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

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
			ctx.ui.notify("Review extension loaded. Target selection is implemented in the next task.", "info");
		},
	});
}
```

Modify `package.json` and add the review extension to `pi.extensions`:

```json
"./extensions/review/index.ts"
```

Place it after `./extensions/little-renderer/index.ts` and before `./extensions/little-spinner/index.ts` to keep the list readable.

- [ ] **Step 4: Run the test and typecheck**

Run: `npm test -- review-extension.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 5: Commit slice progress**

```bash
git add package.json extensions/review/index.ts review-extension.test.ts
git commit -m "feat(review): register review command"
```

### Task 2: Add git target resolution for uncommitted and base modes

**Files:**
- Create: `extensions/review/git.ts`
- Test: `review-git.test.ts`

- [ ] **Step 1: Write failing git helper tests**

Create `review-git.test.ts`:

```ts
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
	buildBaseReviewTarget,
	buildUncommittedReviewTarget,
	detectBaseRef,
	isGitRepository,
} from "./extensions/review/git.ts";

function run(cwd: string, args: string[]): void {
	const result = spawnSync("git", args, { cwd, stdio: "pipe" });
	if (result.status !== 0) {
		throw new Error(result.stderr.toString() || result.stdout.toString());
	}
}

function makeRepo(): string {
	const cwd = mkdtempSync(join(tmpdir(), "review-git-"));
	run(cwd, ["init", "-b", "main"]);
	run(cwd, ["config", "user.email", "test@example.com"]);
	run(cwd, ["config", "user.name", "Test User"]);
	writeFileSync(join(cwd, "README.md"), "hello\n", "utf-8");
	run(cwd, ["add", "README.md"]);
	run(cwd, ["commit", "-m", "initial"]);
	return cwd;
}

describe("review git helpers", () => {
	it("detects whether cwd is inside a git repository", () => {
		const cwd = makeRepo();
		const outside = mkdtempSync(join(tmpdir(), "review-no-git-"));

		expect(isGitRepository(cwd)).toBe(true);
		expect(isGitRepository(outside)).toBe(false);
	});

	it("builds an uncommitted target with staged and unstaged changes", () => {
		const cwd = makeRepo();
		writeFileSync(join(cwd, "README.md"), "hello\nworld\n", "utf-8");
		writeFileSync(join(cwd, "new.txt"), "new\n", "utf-8");
		run(cwd, ["add", "new.txt"]);

		const target = buildUncommittedReviewTarget(cwd);

		expect(target.mode).toBe("uncommitted");
		expect(target.changedFiles).toEqual(["README.md", "new.txt"]);
		expect(target.stagedCount).toBe(1);
		expect(target.unstagedCount).toBe(1);
		expect(target.promptContext).toContain("git diff --cached");
		expect(target.promptContext).toContain("diff --git");
	});

	it("autodetects main as base and builds a base target including working tree changes", () => {
		const cwd = makeRepo();
		run(cwd, ["checkout", "-b", "feature"]);
		writeFileSync(join(cwd, "README.md"), "hello\nbranch\n", "utf-8");
		run(cwd, ["commit", "-am", "branch change"]);
		writeFileSync(join(cwd, "scratch.txt"), "dirty\n", "utf-8");

		expect(detectBaseRef(cwd)).toBe("main");

		const target = buildBaseReviewTarget(cwd, "main");
		expect(target.mode).toBe("base");
		expect(target.baseRef).toBe("main");
		expect(target.changedFiles).toContain("README.md");
		expect(target.changedFiles).toContain("scratch.txt");
		expect(target.promptContext).toContain("merge base");
		expect(target.promptContext).toContain("branch change");
		expect(target.promptContext).toContain("scratch.txt");
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- review-git.test.ts`

Expected: FAIL because `extensions/review/git.ts` does not exist.

- [ ] **Step 3: Implement git helpers**

Create `extensions/review/git.ts` with these exported types and functions:

```ts
import { spawnSync } from "node:child_process";

export type ReviewMode = "uncommitted" | "base" | "commit" | "pr";

export interface ReviewTarget {
	mode: ReviewMode;
	label: string;
	promptContext: string;
	changedFiles: string[];
	stagedCount: number;
	unstagedCount: number;
	baseRef?: string;
	mergeBase?: string;
	commitRef?: string;
	prUrl?: string;
	originalRef?: string;
}

interface GitResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

function git(cwd: string, args: string[]): GitResult {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return {
		ok: result.status === 0,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function lines(output: string): string[] {
	return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

export function isGitRepository(cwd: string): boolean {
	return git(cwd, ["rev-parse", "--is-inside-work-tree"]).stdout.trim() === "true";
}

export function getCurrentRef(cwd: string): string {
	const branch = git(cwd, ["branch", "--show-current"]).stdout.trim();
	if (branch) return branch;
	const head = git(cwd, ["rev-parse", "--short", "HEAD"]).stdout.trim();
	return head || "HEAD";
}

export function countChangedFiles(cwd: string, args: string[]): number {
	return lines(git(cwd, args).stdout).length;
}

export function getPorcelainFiles(cwd: string): string[] {
	return uniqueSorted(
		lines(git(cwd, ["status", "--porcelain"]).stdout).map((line) => {
			const renamed = line.slice(3).split(" -> ");
			return renamed[renamed.length - 1]!;
		}),
	);
}

export function detectBaseRef(cwd: string): string | undefined {
	const upstream = git(cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
	if (upstream.ok && upstream.stdout.trim()) return upstream.stdout.trim();

	const originHead = git(cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
	if (originHead.ok && originHead.stdout.trim()) return originHead.stdout.trim();

	for (const candidate of ["main", "master"]) {
		if (git(cwd, ["rev-parse", "--verify", "--quiet", candidate]).ok) return candidate;
	}

	return undefined;
}

export function buildUncommittedReviewTarget(cwd: string): ReviewTarget {
	const staged = git(cwd, ["diff", "--cached", "--", "."]).stdout;
	const unstaged = git(cwd, ["diff", "--", "."]).stdout;
	const files = getPorcelainFiles(cwd);
	return {
		mode: "uncommitted",
		label: "Uncommitted changes",
		promptContext: [
			"# Review target: uncommitted changes",
			"",
			"## git diff --cached",
			staged || "(no staged changes)",
			"",
			"## git diff",
			unstaged || "(no unstaged changes)",
		].join("\n"),
		changedFiles: files,
		stagedCount: countChangedFiles(cwd, ["diff", "--cached", "--name-only", "--", "."]),
		unstagedCount: countChangedFiles(cwd, ["diff", "--name-only", "--", "."]),
	};
}

export function buildBaseReviewTarget(cwd: string, baseRef: string): ReviewTarget {
	const mergeBase = git(cwd, ["merge-base", baseRef, "HEAD"]).stdout.trim();
	if (!mergeBase) throw new Error(`Could not compute merge base for ${baseRef}`);

	const committed = git(cwd, ["diff", `${mergeBase}..HEAD`, "--", "."]).stdout;
	const staged = git(cwd, ["diff", "--cached", "--", "."]).stdout;
	const unstaged = git(cwd, ["diff", "--", "."]).stdout;
	const files = uniqueSorted([
		...lines(git(cwd, ["diff", "--name-only", `${mergeBase}..HEAD`, "--", "."]).stdout),
		...getPorcelainFiles(cwd),
	]);

	return {
		mode: "base",
		label: `Local changes against ${baseRef}`,
		promptContext: [
			`# Review target: local changes against base`,
			`Base ref: ${baseRef}`,
			`merge base: ${mergeBase}`,
			"",
			"## committed changes",
			committed || "(no committed branch changes)",
			"",
			"## staged changes",
			staged || "(no staged changes)",
			"",
			"## unstaged changes",
			unstaged || "(no unstaged changes)",
		].join("\n"),
		changedFiles: files,
		stagedCount: countChangedFiles(cwd, ["diff", "--cached", "--name-only", "--", "."]),
		unstagedCount: countChangedFiles(cwd, ["diff", "--name-only", "--", "."]),
		baseRef,
		mergeBase,
	};
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- review-git.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/review/git.ts review-git.test.ts
git commit -m "feat(review): resolve git review targets"
```

### Task 3: Parse structured findings and derive source excerpts

**Files:**
- Create: `extensions/review/findings.ts`
- Test: `review-findings.test.ts`

- [ ] **Step 1: Write failing finding tests**

Create `review-findings.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	extractFindingsBlock,
	loadSourceExcerpt,
	normalizeFindings,
	type RawFinding,
} from "./extensions/review/findings.ts";

describe("review findings", () => {
	it("extracts a fenced review findings JSON block", () => {
		const output = [
			"Review complete.",
			"```review-findings",
			JSON.stringify({ summary: "One issue", findings: [{ severity: "high", file: "src/a.ts", startLine: 4, title: "Bug", explanation: "Bad", suggestedFix: "Fix it" }] }),
			"```",
		].join("\n");

		const parsed = extractFindingsBlock(output);
		expect(parsed.summary).toBe("One issue");
		expect(parsed.findings).toHaveLength(1);
	});

	it("normalizes findings with stable deterministic ids", () => {
		const raw: RawFinding[] = [
			{ id: "model-id", severity: "HIGH", file: "./src/a.ts", startLine: 4, title: "Bug", explanation: "Bad", suggestedFix: "Fix it" },
			{ severity: "unknown", file: "src/b.ts", startLine: 2, title: "Risk", explanation: "Maybe bad", suggestedFix: "Check it" },
		];

		const normalized = normalizeFindings(raw);

		expect(normalized[0]).toMatchObject({ severity: "high", file: "src/a.ts", startLine: 4, status: "open" });
		expect(normalized[0]!.id).toMatch(/^finding-/);
		expect(normalized[0]!.id).toBe(normalizeFindings(raw)[0]!.id);
		expect(normalized[1]!.severity).toBe("medium");
	});

	it("loads a bounded source excerpt around the finding line", () => {
		const cwd = mkdtempSync(join(tmpdir(), "review-excerpt-"));
		mkdirSync(join(cwd, "src"));
		writeFileSync(join(cwd, "src", "a.ts"), "one\ntwo\nthree\nfour\nfive\nsix\n", "utf-8");

		const excerpt = loadSourceExcerpt(cwd, { file: "src/a.ts", startLine: 4, endLine: 4 }, 1);

		expect(excerpt.available).toBe(true);
		expect(excerpt.lines.map((line) => `${line.number}:${line.text}`)).toEqual(["3:three", "4:four", "5:five"]);
	});
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- review-findings.test.ts`

Expected: FAIL because `extensions/review/findings.ts` does not exist.

- [ ] **Step 3: Implement findings helpers**

Create `extensions/review/findings.ts`:

```ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { normalize, relative, resolve } from "node:path";

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "ignored";

export interface RawFinding {
	id?: string;
	severity?: string;
	file?: string;
	startLine?: number;
	startColumn?: number;
	endLine?: number;
	endColumn?: number;
	title?: string;
	explanation?: string;
	suggestedFix?: string;
}

export interface ReviewFinding {
	id: string;
	severity: FindingSeverity;
	file: string;
	startLine: number;
	startColumn?: number;
	endLine?: number;
	endColumn?: number;
	title: string;
	explanation: string;
	suggestedFix: string;
	status: FindingStatus;
}

export interface ParsedFindings {
	summary: string;
	findings: RawFinding[];
}

export interface SourceExcerptLine {
	number: number;
	text: string;
	selected: boolean;
}

export interface SourceExcerpt {
	available: boolean;
	message?: string;
	lines: SourceExcerptLine[];
}

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Findings block must be a JSON object.");
	}
	return value as Record<string, unknown>;
}

export function extractFindingsBlock(output: string): ParsedFindings {
	const match = /```review-findings\s*([\s\S]*?)```/m.exec(output);
	if (!match) throw new Error("Missing ```review-findings fenced block.");

	const parsed = asObject(JSON.parse(match[1]!.trim()));
	const summary = typeof parsed.summary === "string" ? parsed.summary : "";
	if (!Array.isArray(parsed.findings)) throw new Error("findings must be an array.");
	return { summary, findings: parsed.findings as RawFinding[] };
}

function normalizeSeverity(value: string | undefined): FindingSeverity {
	const normalized = value?.trim().toLowerCase();
	if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") return normalized;
	return "medium";
}

function normalizeFilePath(file: string): string {
	const normalized = normalize(file).replace(/\\/g, "/").replace(/^\.\//, "");
	if (!normalized || normalized.startsWith("../") || normalized === "..") {
		throw new Error(`Invalid finding file path: ${file}`);
	}
	return normalized;
}

function stableId(finding: Omit<ReviewFinding, "id" | "status" | "severity"> & { severity: FindingSeverity }): string {
	const hash = createHash("sha1")
		.update([finding.file, finding.startLine, finding.startColumn ?? "", finding.endLine ?? "", finding.title, finding.explanation].join("\0"))
		.digest("hex")
		.slice(0, 12);
	return `finding-${hash}`;
}

export function normalizeFindings(rawFindings: RawFinding[]): ReviewFinding[] {
	return rawFindings.map((raw) => {
		if (!raw.file || typeof raw.file !== "string") throw new Error("Finding is missing file.");
		if (!Number.isInteger(raw.startLine) || raw.startLine! < 1) throw new Error(`Finding for ${raw.file} is missing a valid startLine.`);
		if (!raw.title || !raw.explanation || !raw.suggestedFix) throw new Error(`Finding for ${raw.file}:${raw.startLine} is incomplete.`);

		const findingWithoutId = {
			severity: normalizeSeverity(raw.severity),
			file: normalizeFilePath(raw.file),
			startLine: raw.startLine!,
			startColumn: Number.isInteger(raw.startColumn) && raw.startColumn! > 0 ? raw.startColumn : undefined,
			endLine: Number.isInteger(raw.endLine) && raw.endLine! >= raw.startLine! ? raw.endLine : undefined,
			endColumn: Number.isInteger(raw.endColumn) && raw.endColumn! > 0 ? raw.endColumn : undefined,
			title: raw.title.trim(),
			explanation: raw.explanation.trim(),
			suggestedFix: raw.suggestedFix.trim(),
		};

		return {
			...findingWithoutId,
			id: stableId(findingWithoutId),
			status: "open",
		};
	});
}

export function loadSourceExcerpt(cwd: string, location: Pick<ReviewFinding, "file" | "startLine" | "endLine">, contextLines = 3): SourceExcerpt {
	const root = resolve(cwd);
	const filePath = resolve(root, location.file);
	if (relative(root, filePath).startsWith("..")) {
		return { available: false, message: "Source unavailable: path is outside the workspace.", lines: [] };
	}
	if (!existsSync(filePath)) {
		return { available: false, message: "Source unavailable: file does not exist.", lines: [] };
	}

	const allLines = readFileSync(filePath, "utf-8").split(/\r?\n/);
	if (location.startLine < 1 || location.startLine > allLines.length) {
		return { available: false, message: "Source unavailable: line is outside the file.", lines: [] };
	}

	const selectedEnd = location.endLine ?? location.startLine;
	const start = Math.max(1, location.startLine - contextLines);
	const end = Math.min(allLines.length, selectedEnd + contextLines);
	const lines: SourceExcerptLine[] = [];
	for (let number = start; number <= end; number++) {
		lines.push({
			number,
			text: allLines[number - 1] ?? "",
			selected: number >= location.startLine && number <= selectedEnd,
		});
	}
	return { available: true, lines };
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test -- review-findings.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/review/findings.ts review-findings.test.ts
git commit -m "feat(review): parse structured findings"
```

### Task 4: Build review prompt and basic blocking navigator

**Files:**
- Create: `extensions/review/prompt.ts`
- Create: `extensions/review/ui.ts`
- Modify: `extensions/review/index.ts`
- Test: `review-extension.test.ts`

- [ ] **Step 1: Add failing orchestration tests**

Append to `review-extension.test.ts`:

```ts
function makeCommandCtx(overrides: Partial<any> = {}) {
	return {
		cwd: "/tmp/project",
		hasUI: true,
		model: { id: "test/model", provider: "test" },
		ui: {
			notify: vi.fn(),
			select: vi.fn(async () => "Uncommitted changes"),
			confirm: vi.fn(async () => true),
			input: vi.fn(async () => "main"),
			custom: vi.fn(async () => "closed"),
			theme: { fg: (_role: string, text: string) => text },
		},
		sessionManager: {
			getBranch: () => [{ id: "root", type: "message", message: { role: "user", content: [{ type: "text", text: "start" }] } }],
		},
		fork: vi.fn(async (_entryId: string, options: any) => {
			await options?.withSession?.({
				sendUserMessage: vi.fn(async () => {}),
				waitForIdle: vi.fn(async () => {}),
				sessionManager: {
					getBranch: () => [
						{ id: "root", type: "message", message: { role: "user", content: [{ type: "text", text: "start" }] } },
						{ id: "assistant", type: "message", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "```review-findings\n{\"summary\":\"none\",\"findings\":[]}\n```" }] } },
					],
				},
			});
			return { cancelled: false };
		}),
		waitForIdle: vi.fn(async () => {}),
		...overrides,
	};
}

it("rejects /review without interactive UI", async () => {
	const { pi, commands } = makePi();
	const { default: reviewExtension } = await import("./extensions/review/index.ts");
	reviewExtension(pi as never);

	const ctx = makeCommandCtx({ hasUI: false });
	await commands.get("review").handler("", ctx);

	expect(ctx.ui.notify).toHaveBeenCalledWith("/review requires interactive mode", "error");
});

it("rejects /review without a selected model", async () => {
	const { pi, commands } = makePi();
	const { default: reviewExtension } = await import("./extensions/review/index.ts");
	reviewExtension(pi as never);

	const ctx = makeCommandCtx({ model: undefined });
	await commands.get("review").handler("", ctx);

	expect(ctx.ui.notify).toHaveBeenCalledWith("Select a model before running /review.", "error");
});
```

Add a small test that invokes handler with non-git cwd by mocking git helpers only if needed. If mocking is too brittle for ESM, cover non-git behavior in `review-git.test.ts` and keep command tests focused on early UI/model guards.

- [ ] **Step 2: Run tests to verify current behavior**

Run: `npm test -- review-extension.test.ts`

Expected: The first two added tests pass after Task 1; any orchestration-specific test should fail until the handler uses target selection.

- [ ] **Step 3: Implement prompt builder**

Create `extensions/review/prompt.ts`:

```ts
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
		JSON.stringify({
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
		}, null, 2),
		"```",
		"",
		"If there are no actionable findings, return findings as an empty array.",
		"",
		target.promptContext,
	].join("\n");
}
```

- [ ] **Step 4: Implement basic UI helpers**

Create `extensions/review/ui.ts`:

```ts
import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";
import type { ReviewTarget } from "./git.ts";
import type { ReviewFinding } from "./findings.ts";

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
		target.changedFiles.length ? target.changedFiles.map((file) => `- ${file}`).join("\n") : "No changed files detected.",
	].filter((part): part is string => part !== undefined).join("\n");
}

export async function confirmPreflight(ctx: ExtensionCommandContext, target: ReviewTarget): Promise<boolean> {
	return ctx.ui.confirm("Start code review?", formatPreflight(target));
}

class FindingsDialog implements Component {
	private index = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly target: ReviewTarget,
		private readonly findings: ReviewFinding[],
		private readonly theme: Theme,
		private readonly done: (result: "closed") => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.done("closed");
			return;
		}
		if (matchesKey(data, Key.right) || data === "n") {
			this.index = Math.min(this.findings.length - 1, this.index + 1);
			this.invalidate();
			return;
		}
		if (matchesKey(data, Key.left) || data === "p") {
			this.index = Math.max(0, this.index - 1);
			this.invalidate();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const innerWidth = Math.max(20, width - 4);
		const lines: string[] = [];
		const push = (line = "") => lines.push(`| ${truncateToWidth(line, innerWidth).padEnd(innerWidth, " ")} |`);

		lines.push(`+${"-".repeat(innerWidth + 2)}+`);
		push(this.theme.fg("accent", "Code review findings"));
		push(this.theme.fg("dim", this.target.label));
		push();

		if (this.findings.length === 0) {
			push("No actionable findings found.");
			push();
			push("Esc: close");
		} else {
			const finding = this.findings[this.index]!;
			push(`${this.index + 1} / ${this.findings.length}  ${finding.severity.toUpperCase()}  ${finding.file}:${finding.startLine}`);
			push(finding.title);
			push();
			for (const line of wrapTextWithAnsi(finding.explanation, innerWidth)) push(line);
			push();
			push("Suggested fix:");
			for (const line of wrapTextWithAnsi(finding.suggestedFix, innerWidth)) push(line);
			push();
			push("n/right: next  p/left: previous  Esc: close");
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

export async function showFindings(ctx: ExtensionCommandContext, target: ReviewTarget, findings: ReviewFinding[]): Promise<void> {
	await ctx.ui.custom<"closed">((_tui, theme, _keybindings, done) => new FindingsDialog(target, findings, theme, done), {
		overlay: true,
		overlayOptions: { width: "80%", minWidth: 60, maxHeight: "70%", anchor: "bottom", margin: 1 },
	});
}
```

- [ ] **Step 5: Wire `/review` for the first two modes**

Modify `extensions/review/index.ts`:

```ts
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildBaseReviewTarget, buildUncommittedReviewTarget, detectBaseRef, isGitRepository } from "./git.ts";
import { extractFindingsBlock, normalizeFindings } from "./findings.ts";
import { buildReviewPrompt } from "./prompt.ts";
import { chooseInitialMode, confirmPreflight, showFindings } from "./ui.ts";

function lastAssistantText(ctx: Pick<ExtensionCommandContext, "sessionManager">): string {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
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

			const target = mode === "uncommitted"
				? buildUncommittedReviewTarget(ctx.cwd)
				: buildBaseReviewTarget(ctx.cwd, detectBaseRef(ctx.cwd) ?? await ctx.ui.input("Base branch", "main"));

			if (!(await confirmPreflight(ctx, target))) {
				ctx.ui.notify("Review cancelled.", "info");
				return;
			}

			const leafId = currentLeafId(ctx);
			if (!leafId) {
				ctx.ui.notify("Cannot start review without a session leaf.", "error");
				return;
			}

			let output = "";
			const prompt = buildReviewPrompt(target);
			await ctx.fork(leafId, {
				position: "at",
				withSession: async (reviewCtx) => {
					await reviewCtx.sendUserMessage(prompt);
					await reviewCtx.waitForIdle();
					output = lastAssistantText(reviewCtx);
				},
			});

			const parsed = extractFindingsBlock(output);
			const findings = normalizeFindings(parsed.findings);
			await showFindings(ctx, target, findings);
		},
	});
}
```

If TypeScript reports that `ctx.ui.input()` can return `undefined`, handle it explicitly:

```ts
const base = detectBaseRef(ctx.cwd) ?? await ctx.ui.input("Base branch", "main");
if (!base) {
	ctx.ui.notify("Review cancelled.", "info");
	return;
}
```

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- review-extension.test.ts review-git.test.ts review-findings.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extensions/review/index.ts extensions/review/prompt.ts extensions/review/ui.ts review-extension.test.ts
git commit -m "feat(review): run basic structured reviews"
```

---

## Slice 2: Persist Ignore State And Current Index

### Task 5: Add review state helpers

**Files:**
- Create: `extensions/review/state.ts`
- Modify: `extensions/review/ui.ts`
- Modify: `extensions/review/index.ts`
- Test: `review-state.test.ts`

- [ ] **Step 1: Write failing state tests**

Create `review-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
	REVIEW_STATE_ENTRY_TYPE,
	buildInitialReviewState,
	rebuildLatestReviewState,
	updateFindingStatus,
	updateReviewIndex,
} from "./extensions/review/state.ts";
import type { ReviewFinding } from "./extensions/review/findings.ts";

const findings: ReviewFinding[] = [
	{ id: "a", severity: "high", file: "a.ts", startLine: 1, title: "A", explanation: "bad", suggestedFix: "fix", status: "open" },
	{ id: "b", severity: "low", file: "b.ts", startLine: 2, title: "B", explanation: "risk", suggestedFix: "fix", status: "open" },
];

describe("review state", () => {
	it("creates durable initial state", () => {
		const state = buildInitialReviewState({ mode: "uncommitted", label: "Uncommitted", changedFiles: [], stagedCount: 0, unstagedCount: 0, promptContext: "diff" }, findings, "raw output");

		expect(state.kind).toBe("review-state");
		expect(state.findings).toHaveLength(2);
		expect(state.currentIndex).toBe(0);
		expect(state.rawReviewOutput).toBe("raw output");
	});

	it("updates finding status and current index immutably", () => {
		const state = buildInitialReviewState({ mode: "uncommitted", label: "Uncommitted", changedFiles: [], stagedCount: 0, unstagedCount: 0, promptContext: "diff" }, findings, "raw");

		const ignored = updateFindingStatus(state, "a", "ignored");
		expect(ignored.findings[0]!.status).toBe("ignored");
		expect(state.findings[0]!.status).toBe("open");

		const moved = updateReviewIndex(ignored, 1);
		expect(moved.currentIndex).toBe(1);
	});

	it("rebuilds latest state from custom entries", () => {
		const state = buildInitialReviewState({ mode: "uncommitted", label: "Uncommitted", changedFiles: [], stagedCount: 0, unstagedCount: 0, promptContext: "diff" }, findings, "raw");
		const entries = [
			{ type: "custom", customType: "other", data: {} },
			{ type: "custom", customType: REVIEW_STATE_ENTRY_TYPE, data: state },
		];

		expect(rebuildLatestReviewState(entries)?.runId).toBe(state.runId);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- review-state.test.ts`

Expected: FAIL because `state.ts` does not exist.

- [ ] **Step 3: Implement state helpers**

Create `extensions/review/state.ts`:

```ts
import type { ReviewFinding, FindingStatus } from "./findings.ts";
import type { ReviewTarget } from "./git.ts";

export const REVIEW_STATE_ENTRY_TYPE = "review-state";

export interface ReviewQnaTurn {
	question: string;
	answer: string;
	timestamp: number;
}

export interface ReviewRunState {
	kind: "review-state";
	runId: string;
	createdAt: number;
	target: Omit<ReviewTarget, "promptContext">;
	rawReviewOutput: string;
	findings: ReviewFinding[];
	currentIndex: number;
	qnaByFindingId: Record<string, ReviewQnaTurn[]>;
}

export function buildInitialReviewState(target: ReviewTarget, findings: ReviewFinding[], rawReviewOutput: string): ReviewRunState {
	const { promptContext: _promptContext, ...persistedTarget } = target;
	return {
		kind: "review-state",
		runId: `review-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
		createdAt: Date.now(),
		target: persistedTarget,
		rawReviewOutput,
		findings,
		currentIndex: 0,
		qnaByFindingId: {},
	};
}

export function updateFindingStatus(state: ReviewRunState, findingId: string, status: FindingStatus): ReviewRunState {
	return {
		...state,
		findings: state.findings.map((finding) => finding.id === findingId ? { ...finding, status } : finding),
	};
}

export function updateReviewIndex(state: ReviewRunState, index: number): ReviewRunState {
	const max = Math.max(0, state.findings.length - 1);
	return { ...state, currentIndex: Math.max(0, Math.min(max, index)) };
}

export function rebuildLatestReviewState(entries: Array<any>): ReviewRunState | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type === "custom" && entry.customType === REVIEW_STATE_ENTRY_TYPE && entry.data?.kind === "review-state") {
			return entry.data as ReviewRunState;
		}
	}
	return undefined;
}
```

- [ ] **Step 4: Wire state persistence from index and UI**

Modify `extensions/review/ui.ts` so `showFindings()` receives a state object and returns the updated state:

```ts
import { updateFindingStatus, updateReviewIndex, type ReviewRunState } from "./state.ts";

export async function showFindings(ctx: ExtensionCommandContext, state: ReviewRunState): Promise<ReviewRunState> {
	let latest = state;
	await ctx.ui.custom<ReviewRunState>((_tui, theme, _keybindings, done) => {
		const dialog = new FindingsDialog(latest.target as ReviewTarget, latest.findings, theme, (result) => {
			latest = { ...latest, currentIndex: result.currentIndex, findings: result.findings };
			done(latest);
		});
		return dialog;
	}, {
		overlay: true,
		overlayOptions: { width: "80%", minWidth: 60, maxHeight: "70%", anchor: "bottom", margin: 1 },
	});
	return latest;
}
```

In the actual `FindingsDialog`, add `i` to ignore the current finding, update the cached finding list, and return `currentIndex` plus `findings` on close. The result type should be:

```ts
interface FindingsDialogResult {
	currentIndex: number;
	findings: ReviewFinding[];
}
```

When rendering, show `ignored` next to ignored findings and keep them navigable.

Modify `extensions/review/index.ts` after parsing findings:

```ts
const state = buildInitialReviewState(target, findings, output);
pi.appendEntry(REVIEW_STATE_ENTRY_TYPE, state);
const updated = await showFindings(ctx, state);
if (updated !== state) {
	pi.appendEntry(REVIEW_STATE_ENTRY_TYPE, updated);
}
```

- [ ] **Step 5: Add command-level assertion**

In `review-extension.test.ts`, extend `makePi()`:

```ts
appendEntry: vi.fn(),
```

Add a test that mocks the forked assistant output with one finding, runs `/review`, makes `ctx.ui.custom` return a state with the first finding ignored, and asserts `pi.appendEntry` is called twice with `customType` `review-state`.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- review-state.test.ts review-extension.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extensions/review/state.ts extensions/review/ui.ts extensions/review/index.ts review-state.test.ts review-extension.test.ts
git commit -m "feat(review): persist review state"
```

---

## Slice 3: Q&A Sub-Dialogue

### Task 6: Add Q&A prompt and state updates

**Files:**
- Modify: `extensions/review/prompt.ts`
- Modify: `extensions/review/state.ts`
- Modify: `extensions/review/ui.ts`
- Test: `review-qna.test.ts`

- [ ] **Step 1: Write failing Q&A tests**

Create `review-qna.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildQnaPrompt } from "./extensions/review/prompt.ts";
import { addQnaTurn, buildInitialReviewState } from "./extensions/review/state.ts";
import type { ReviewFinding } from "./extensions/review/findings.ts";

const finding: ReviewFinding = {
	id: "finding-a",
	severity: "high",
	file: "src/a.ts",
	startLine: 10,
	title: "Incorrect cache key",
	explanation: "The cache key omits user id.",
	suggestedFix: "Include user id in the key.",
	status: "open",
};

describe("review qna", () => {
	it("builds a prompt scoped to the selected finding", () => {
		const prompt = buildQnaPrompt({
			finding,
			targetLabel: "Uncommitted changes",
			sourceExcerpt: "10: const key = route;",
			priorTurns: [],
			question: "Why is this high severity?",
		});

		expect(prompt).toContain("Answer only about this selected finding");
		expect(prompt).toContain("Incorrect cache key");
		expect(prompt).toContain("Why is this high severity?");
	});

	it("persists Q&A turns under the finding id", () => {
		const state = buildInitialReviewState({ mode: "uncommitted", label: "Uncommitted", changedFiles: [], stagedCount: 0, unstagedCount: 0, promptContext: "diff" }, [finding], "raw");
		const updated = addQnaTurn(state, "finding-a", { question: "Why?", answer: "Because.", timestamp: 10 });

		expect(updated.qnaByFindingId["finding-a"]).toEqual([{ question: "Why?", answer: "Because.", timestamp: 10 }]);
		expect(state.qnaByFindingId["finding-a"]).toBeUndefined();
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- review-qna.test.ts`

Expected: FAIL because `buildQnaPrompt` and `addQnaTurn` do not exist.

- [ ] **Step 3: Implement Q&A helpers**

Add to `extensions/review/prompt.ts`:

```ts
import type { ReviewFinding, SourceExcerpt } from "./findings.ts";
import type { ReviewQnaTurn } from "./state.ts";

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
```

Add to `extensions/review/state.ts`:

```ts
export function addQnaTurn(state: ReviewRunState, findingId: string, turn: ReviewQnaTurn): ReviewRunState {
	return {
		...state,
		qnaByFindingId: {
			...state.qnaByFindingId,
			[findingId]: [...(state.qnaByFindingId[findingId] ?? []), turn],
		},
	};
}
```

- [ ] **Step 4: Wire Q&A UI**

In `extensions/review/ui.ts`, add a `q` key in `FindingsDialog` that calls a callback. Avoid doing model calls inside the component class; pass an async `askQuestion(findingId: string, question: string) => Promise<void>` from `showFindings`.

In `showFindings`, implement:

```ts
const question = await ctx.ui.input("Ask about this finding", "");
if (!question) return;
const finding = latest.findings.find((item) => item.id === findingId);
if (!finding) return;
const excerpt = loadSourceExcerpt(ctx.cwd, finding);
const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
if (!auth.ok || !auth.apiKey) {
	ctx.ui.notify(auth.ok ? `No API key for ${ctx.model!.provider}` : auth.error, "error");
	return;
}
const response = await complete(ctx.model!, {
	systemPrompt: "You answer focused questions about one code review finding.",
	messages: [{ role: "user", content: [{ type: "text", text: buildQnaPrompt({ finding, targetLabel: latest.target.label, sourceExcerpt: formatExcerptForPrompt(excerpt), priorTurns: latest.qnaByFindingId[finding.id] ?? [], question }) }], timestamp: Date.now() }],
}, { apiKey: auth.apiKey, headers: auth.headers });
const answer = response.content.filter((part): part is { type: "text"; text: string } => part.type === "text").map((part) => part.text).join("\n");
latest = addQnaTurn(latest, finding.id, { question, answer, timestamp: Date.now() });
```

Import `complete` from `@mariozechner/pi-ai`, `loadSourceExcerpt` from `findings.ts`, `buildQnaPrompt` and `formatExcerptForPrompt` from `prompt.ts`, and `addQnaTurn` from `state.ts`.

- [ ] **Step 5: Persist Q&A updates**

In `extensions/review/index.ts`, after `showFindings()` returns, append updated state whenever the returned state differs by reference:

```ts
const updated = await showFindings(ctx, state);
if (updated !== state) {
	pi.appendEntry(REVIEW_STATE_ENTRY_TYPE, updated);
}
```

This should already exist from Slice 2; verify Q&A changes flow through the same persistence path.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- review-qna.test.ts review-state.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS. If `@mariozechner/pi-ai` types are not directly available, inspect `node_modules/@mariozechner/pi-coding-agent/examples/extensions/qna.ts` and mirror its imports exactly.

- [ ] **Step 7: Commit**

```bash
git add extensions/review/prompt.ts extensions/review/state.ts extensions/review/ui.ts extensions/review/index.ts review-qna.test.ts
git commit -m "feat(review): add finding qna"
```

---

## Slice 4: Specific Commit Mode

### Task 7: Add commit review target

**Files:**
- Modify: `extensions/review/git.ts`
- Modify: `extensions/review/ui.ts`
- Test: `review-git.test.ts`

- [ ] **Step 1: Write failing commit target test**

Append to `review-git.test.ts`:

```ts
import { buildCommitReviewTarget } from "./extensions/review/git.ts";

it("builds a commit review target from git show", () => {
	const cwd = makeRepo();
	writeFileSync(join(cwd, "README.md"), "hello\ncommit\n", "utf-8");
	run(cwd, ["commit", "-am", "second"]);
	const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" }).stdout.trim();

	const target = buildCommitReviewTarget(cwd, commit);

	expect(target.mode).toBe("commit");
	expect(target.commitRef).toBe(commit);
	expect(target.changedFiles).toEqual(["README.md"]);
	expect(target.promptContext).toContain("git show");
	expect(target.promptContext).toContain("second");
});
```

If the duplicate import causes a style issue, merge it into the existing import block at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- review-git.test.ts`

Expected: FAIL because `buildCommitReviewTarget` is missing.

- [ ] **Step 3: Implement commit target**

Add to `extensions/review/git.ts`:

```ts
export function buildCommitReviewTarget(cwd: string, commitRef: string): ReviewTarget {
	const show = git(cwd, ["show", "--stat", "--patch", "--find-renames", commitRef]).stdout;
	if (!show.trim()) throw new Error(`Could not read commit ${commitRef}`);
	const files = lines(git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", commitRef]).stdout);
	return {
		mode: "commit",
		label: `Commit ${commitRef}`,
		promptContext: [
			`# Review target: specific commit`,
			`Commit ref: ${commitRef}`,
			"",
			"## git show",
			show,
		].join("\n"),
		changedFiles: uniqueSorted(files),
		stagedCount: 0,
		unstagedCount: 0,
		commitRef,
	};
}
```

- [ ] **Step 4: Add UI option and handler path**

In `extensions/review/ui.ts`, include `"Specific commit"` in the select list and return `"commit"`.

In `extensions/review/index.ts`, handle mode:

```ts
if (mode === "commit") {
	const commitRef = await ctx.ui.input("Commit ref", "HEAD");
	if (!commitRef) {
		ctx.ui.notify("Review cancelled.", "info");
		return;
	}
	target = buildCommitReviewTarget(ctx.cwd, commitRef);
}
```

Update the local `target` construction from a ternary to a `let target` plus `if` branches.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm test -- review-git.test.ts review-extension.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extensions/review/git.ts extensions/review/ui.ts extensions/review/index.ts review-git.test.ts
git commit -m "feat(review): support commit review"
```

---

## Slice 5: Pull Request URL Checkout/Restore Mode

### Task 8: Add PR target checkout and restore helpers

**Files:**
- Modify: `extensions/review/git.ts`
- Modify: `extensions/review/ui.ts`
- Modify: `extensions/review/index.ts`
- Test: `review-pr.test.ts`

- [ ] **Step 1: Write failing PR helper tests with command injection**

Create `review-pr.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildPullRequestReviewTarget, ensureCleanWorktree, restoreOriginalRef, type GitCommandRunner } from "./extensions/review/git.ts";

function fakeRunner(outputs: Record<string, { status: number; stdout?: string; stderr?: string }>): GitCommandRunner {
	return (_cwd, command, args) => {
		const key = [command, ...args].join(" ");
		const output = outputs[key] ?? { status: 1, stderr: `missing fake output for ${key}` };
		return { ok: output.status === 0, stdout: output.stdout ?? "", stderr: output.stderr ?? "" };
	};
}

describe("review pr helpers", () => {
	it("rejects dirty worktrees before checkout", () => {
		const runner = fakeRunner({ "git status --porcelain": { status: 0, stdout: " M file.ts\n" } });

		expect(() => ensureCleanWorktree("/repo", runner)).toThrow("clean worktree");
	});

	it("checks out a PR URL and builds a target", () => {
		const runner = fakeRunner({
			"git status --porcelain": { status: 0, stdout: "" },
			"git branch --show-current": { status: 0, stdout: "main\n" },
			"gh pr checkout https://github.com/acme/repo/pull/12": { status: 0, stdout: "checked out\n" },
			"git diff --name-only main...HEAD -- .": { status: 0, stdout: "src/a.ts\n" },
			"git diff main...HEAD -- .": { status: 0, stdout: "diff --git a/src/a.ts b/src/a.ts\n" },
		});

		const target = buildPullRequestReviewTarget("/repo", "https://github.com/acme/repo/pull/12", runner);

		expect(target.mode).toBe("pr");
		expect(target.prUrl).toBe("https://github.com/acme/repo/pull/12");
		expect(target.originalRef).toBe("main");
		expect(target.changedFiles).toEqual(["src/a.ts"]);
	});

	it("restores the original ref", () => {
		const runner = fakeRunner({ "git checkout main": { status: 0, stdout: "" } });

		expect(restoreOriginalRef("/repo", "main", runner)).toBe(true);
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- review-pr.test.ts`

Expected: FAIL because PR helpers/types are missing.

- [ ] **Step 3: Refactor git runner for injection**

In `extensions/review/git.ts`, export a runner type and default runner:

```ts
export interface GitCommandResult {
	ok: boolean;
	stdout: string;
	stderr: string;
}

export type GitCommandRunner = (cwd: string, command: string, args: string[]) => GitCommandResult;

export const defaultCommandRunner: GitCommandRunner = (cwd, command, args) => {
	const result = spawnSync(command, args, {
		cwd,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};
```

Change the private `git()` helper to accept an optional runner:

```ts
function git(cwd: string, args: string[], runner: GitCommandRunner = defaultCommandRunner): GitCommandResult {
	return runner(cwd, "git", args);
}
```

Update existing helpers to keep their current signatures and use the default runner.

- [ ] **Step 4: Implement PR helpers**

Add to `extensions/review/git.ts`:

```ts
export function ensureCleanWorktree(cwd: string, runner: GitCommandRunner = defaultCommandRunner): void {
	const status = git(cwd, ["status", "--porcelain"], runner);
	if (!status.ok) throw new Error(status.stderr || "Could not read git status.");
	if (status.stdout.trim()) throw new Error("PR review requires a clean worktree before checkout.");
}

export function buildPullRequestReviewTarget(cwd: string, prUrl: string, runner: GitCommandRunner = defaultCommandRunner): ReviewTarget {
	ensureCleanWorktree(cwd, runner);
	const originalRef = getCurrentRef(cwd);
	const checkout = runner(cwd, "gh", ["pr", "checkout", prUrl]);
	if (!checkout.ok) throw new Error(checkout.stderr || checkout.stdout || `Failed to checkout PR ${prUrl}`);
	const diff = git(cwd, ["diff", `${originalRef}...HEAD`, "--", "."], runner).stdout;
	const files = lines(git(cwd, ["diff", "--name-only", `${originalRef}...HEAD`, "--", "."], runner).stdout);
	return {
		mode: "pr",
		label: `Pull request ${prUrl}`,
		promptContext: [
			"# Review target: pull request",
			`PR URL: ${prUrl}`,
			`Original ref: ${originalRef}`,
			"",
			"## PR diff",
			diff || "(no diff found)",
		].join("\n"),
		changedFiles: uniqueSorted(files),
		stagedCount: 0,
		unstagedCount: 0,
		prUrl,
		originalRef,
	};
}

export function restoreOriginalRef(cwd: string, originalRef: string, runner: GitCommandRunner = defaultCommandRunner): boolean {
	return git(cwd, ["checkout", originalRef], runner).ok;
}
```

Fix `getCurrentRef()` to accept the injected runner or add a private `getCurrentRefWithRunner()` so tests use fake outputs. The PR helper must not accidentally call real git in tests.

- [ ] **Step 5: Wire PR option and restoration**

In `extensions/review/ui.ts`, add `"Pull request URL"` to mode selection and return `"pr"`.

In `extensions/review/index.ts`, handle mode:

```ts
if (mode === "pr") {
	const prUrl = await ctx.ui.input("Pull request URL", "");
	if (!prUrl) {
		ctx.ui.notify("Review cancelled.", "info");
		return;
	}
	target = buildPullRequestReviewTarget(ctx.cwd, prUrl);
}
```

Wrap the review agent execution in `try/finally`:

```ts
let restoreFailed = false;
try {
	await ctx.fork(...);
} finally {
	if (target.mode === "pr" && target.originalRef) {
		restoreFailed = !restoreOriginalRef(ctx.cwd, target.originalRef);
	}
}
if (restoreFailed) {
	ctx.ui.notify(`Failed to restore original git ref ${target.originalRef}.`, "error");
	return;
}
```

Use the real target variable names from the current file. The restore must run after review success or review error.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- review-pr.test.ts review-git.test.ts review-extension.test.ts`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add extensions/review/git.ts extensions/review/ui.ts extensions/review/index.ts review-pr.test.ts
git commit -m "feat(review): support pull request reviews"
```

---

## Slice 6: JSON Recovery Polish And Disabled Actions Entry Point

### Task 9: Add invalid JSON recovery UI and disabled actions control

**Files:**
- Modify: `extensions/review/ui.ts`
- Modify: `extensions/review/index.ts`
- Modify: `extensions/review/findings.ts`
- Test: `review-findings.test.ts`
- Test: `review-extension.test.ts`

- [ ] **Step 1: Add failing recovery tests**

Append to `review-findings.test.ts`:

```ts
it("reports a clear error for missing findings blocks", () => {
	expect(() => extractFindingsBlock("plain markdown")).toThrow("Missing ```review-findings fenced block.");
});
```

Append to `review-extension.test.ts`:

```ts
it("shows recovery UI when findings parsing fails", async () => {
	const { pi, commands } = makePi();
	const { default: reviewExtension } = await import("./extensions/review/index.ts");
	reviewExtension(pi as never);
	const cwd = makeRepo();
	writeFileSync(join(cwd, "README.md"), "hello\nrecovery\n", "utf-8");
	const ctx = makeCommandCtx({ cwd });
	ctx.fork = vi.fn(async (_entryId: string, options: any) => {
		await options?.withSession?.({
			sendUserMessage: vi.fn(async () => {}),
			waitForIdle: vi.fn(async () => {}),
			sessionManager: { getBranch: () => [{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "not json" }] } }] },
		});
		return { cancelled: false };
	});
	ctx.ui.custom = vi.fn(async () => "cancel");

	await commands.get("review").handler("", ctx);

	expect(ctx.ui.custom).toHaveBeenCalled();
});
```

Add the same `makeRepo()` helper used in `review-git.test.ts` to `review-extension.test.ts` if it is not already present, including `mkdtempSync`, `tmpdir`, `join`, `spawnSync`, and `writeFileSync` imports.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- review-findings.test.ts review-extension.test.ts`

Expected: the missing-block test may already pass; the recovery UI test should fail until recovery handling is wired.

- [ ] **Step 3: Implement recovery UI**

Add to `extensions/review/ui.ts`:

```ts
export type RecoveryChoice = "retry" | "cancel";

export async function showParseRecovery(ctx: ExtensionCommandContext, error: Error, rawOutput: string): Promise<RecoveryChoice> {
	const message = [
		"Could not parse structured review findings.",
		"",
		error.message,
		"",
		"Raw output preview:",
		rawOutput.slice(0, 2000),
	].join("\n");
	const choice = await ctx.ui.select(message, ["Retry extraction", "Cancel"]);
	return choice === "Retry extraction" ? "retry" : "cancel";
}
```

Add a disabled action branch in `FindingsDialog.handleInput()`:

```ts
if (data === "a") {
	this.statusMessage = "Actions are not designed yet.";
	this.invalidate();
	return;
}
```

Render the controls line as:

```ts
"n/right: next  p/left: previous  i: ignore  q: ask  a: actions unavailable  Esc: close"
```

Add `private statusMessage = "";` and render it in dim text when set.

- [ ] **Step 4: Wire parse recovery in the command**

Add a formatter prompt to `extensions/review/prompt.ts`:

```ts
export function buildFindingsFormatterPrompt(rawOutput: string): string {
	return [
		"Convert this code review output into the required structured findings JSON.",
		"Preserve only actionable findings. Drop non-actionable notes.",
		"Return exactly one fenced block named review-findings and no other prose.",
		"The JSON shape is { \"summary\": string, \"findings\": Array<{ \"id\"?: string, \"severity\": string, \"file\": string, \"startLine\": number, \"startColumn\"?: number, \"endLine\"?: number, \"endColumn\"?: number, \"title\": string, \"explanation\": string, \"suggestedFix\": string }> }.",
		"If there are no actionable findings, use an empty findings array.",
		"",
		"Raw review output:",
		rawOutput,
	].join("\n");
}
```

In `extensions/review/index.ts`, add a helper near `lastAssistantText()`:

```ts
async function retryFormatFindings(ctx: ExtensionCommandContext, rawOutput: string): Promise<string> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
	if (!auth.ok || !auth.apiKey) {
		throw new Error(auth.ok ? `No API key for ${ctx.model!.provider}` : auth.error);
	}
	const response = await complete(ctx.model!, {
		systemPrompt: "You format code review findings into strict JSON.",
		messages: [{
			role: "user",
			content: [{ type: "text", text: buildFindingsFormatterPrompt(rawOutput) }],
			timestamp: Date.now(),
		}],
	}, { apiKey: auth.apiKey, headers: auth.headers });
	return response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}
```

Import `complete` from `@mariozechner/pi-ai` and import `buildFindingsFormatterPrompt` from `prompt.ts`.

Then replace direct parsing with:

```ts
let parsed;
try {
	parsed = extractFindingsBlock(output);
} catch (error) {
	const choice = await showParseRecovery(ctx, error instanceof Error ? error : new Error(String(error)), output);
	if (choice === "cancel") {
		ctx.ui.notify("Review cancelled.", "info");
		return;
	}
	const formatted = await retryFormatFindings(ctx, output);
	parsed = extractFindingsBlock(formatted);
}
```

Extend the recovery test so `ctx.ui.select` returns `"Retry extraction"` and mock `ctx.modelRegistry.getApiKeyAndHeaders` plus `complete()` to return a valid `review-findings` block. Add a separate test where `ctx.ui.select` returns `"Cancel"` and assert no findings navigator opens after recovery cancellation.

- [ ] **Step 5: Run full verification**

Run: `npm test`

Expected: PASS.

Run: `npm run check`

Expected: PASS.

Run: `npm run pack:dry-run`

Expected: PASS and package contents include `extensions/review/` but no `extensions/**/*.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add extensions/review/ui.ts extensions/review/index.ts extensions/review/findings.ts review-findings.test.ts review-extension.test.ts
git commit -m "feat(review): add review recovery polish"
```

---

## Final Manual Verification

- [ ] Start Pi in this repo and run `/reload`.
- [ ] Run `/review`.
- [ ] Pick `Uncommitted changes` with a small dirty diff.
- [ ] Confirm the preflight summary lists the expected files.
- [ ] Let the review finish.
- [ ] Verify no findings shows the empty state, or findings show one at a time.
- [ ] Navigate with next/previous.
- [ ] Ignore a finding and verify it remains visible as ignored.
- [ ] Ask a focused Q&A question on a finding and verify the answer stays scoped.
- [ ] Try exit with open findings and verify confirmation appears.
- [ ] Run commit mode with `HEAD`.
- [ ] Run PR mode only from a clean worktree and verify the original branch is restored.

## Self-Review

- Spec coverage: all six spec slices are represented: initial modes and navigator in Slice 1, persistence in Slice 2, Q&A in Slice 3, commit mode in Slice 4, PR checkout/restore in Slice 5, recovery and disabled actions in Slice 6.
- Placeholder scan: the actions entry point is intentionally disabled in v1 with explicit behavior and tests; no task depends on undefined action behavior.
- Type consistency: core names stay stable across tasks: `ReviewTarget`, `ReviewFinding`, `ReviewRunState`, `buildReviewPrompt`, `showFindings`, `REVIEW_STATE_ENTRY_TYPE`, and `buildPullRequestReviewTarget`.
