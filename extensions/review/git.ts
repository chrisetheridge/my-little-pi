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
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
}

function rawLines(output: string): string[] {
	return output.split("\n").filter(Boolean);
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
		rawLines(git(cwd, ["status", "--porcelain"]).stdout).map((line) => {
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
	const status = git(cwd, ["status", "--porcelain"]).stdout;

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
			"",
			"## git status --porcelain",
			status || "(clean)",
		].join("\n"),
		changedFiles: getPorcelainFiles(cwd),
		stagedCount: countChangedFiles(cwd, ["diff", "--cached", "--name-only", "--", "."]),
		unstagedCount: countChangedFiles(cwd, ["diff", "--name-only", "--", "."]),
	};
}

export function buildBaseReviewTarget(cwd: string, baseRef: string): ReviewTarget {
	const mergeBase = git(cwd, ["merge-base", baseRef, "HEAD"]).stdout.trim();
	if (!mergeBase) throw new Error(`Could not compute merge base for ${baseRef}`);

	const committed = git(cwd, ["diff", `${mergeBase}..HEAD`, "--", "."]).stdout;
	const commits = git(cwd, ["log", "--oneline", `${mergeBase}..HEAD`]).stdout;
	const staged = git(cwd, ["diff", "--cached", "--", "."]).stdout;
	const unstaged = git(cwd, ["diff", "--", "."]).stdout;
	const status = git(cwd, ["status", "--porcelain"]).stdout;
	const files = uniqueSorted([
		...lines(git(cwd, ["diff", "--name-only", `${mergeBase}..HEAD`, "--", "."]).stdout),
		...getPorcelainFiles(cwd),
	]);

	return {
		mode: "base",
		label: `Local changes against ${baseRef}`,
		promptContext: [
			"# Review target: local changes against base",
			`Base ref: ${baseRef}`,
			`merge base: ${mergeBase}`,
			"",
			"## committed changes",
			commits || "(no committed branch changes)",
			"",
			committed || "(no committed branch diff)",
			"",
			"## staged changes",
			staged || "(no staged changes)",
			"",
			"## unstaged changes",
			unstaged || "(no unstaged changes)",
			"",
			"## git status --porcelain",
			status || "(clean)",
		].join("\n"),
		changedFiles: files,
		stagedCount: countChangedFiles(cwd, ["diff", "--cached", "--name-only", "--", "."]),
		unstagedCount: countChangedFiles(cwd, ["diff", "--name-only", "--", "."]),
		baseRef,
		mergeBase,
	};
}
