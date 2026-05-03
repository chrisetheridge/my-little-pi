import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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

interface PorcelainEntry {
	status: string;
	path: string;
	originalPath?: string;
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

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function getPorcelainEntries(cwd: string): PorcelainEntry[] {
	const parts = git(cwd, ["status", "--porcelain=v1", "-z"]).stdout.split("\0").filter(Boolean);
	const entries: PorcelainEntry[] = [];

	for (let i = 0; i < parts.length; i += 1) {
		const part = parts[i]!;
		const status = part.slice(0, 2);
		const path = part.slice(3);
		const entry: PorcelainEntry = { status, path };

		if (status.includes("R") || status.includes("C")) {
			entry.originalPath = parts[i + 1];
			i += 1;
		}

		entries.push(entry);
	}

	return entries;
}

function getUntrackedFilesFromEntries(entries: PorcelainEntry[]): string[] {
	return uniqueSorted(entries.filter((entry) => entry.status === "??").map((entry) => entry.path));
}

function formatPorcelainEntries(entries: PorcelainEntry[]): string {
	if (entries.length === 0) return "(clean)";

	return entries
		.map((entry) => {
			if (entry.originalPath) return `${entry.status} ${entry.originalPath} -> ${entry.path}`;
			return `${entry.status} ${entry.path}`;
		})
		.join("\n");
}

function buildUntrackedFilesContext(cwd: string, files: string[]): string {
	if (files.length === 0) return "(no untracked files)";

	return files
		.map((file) => {
			const filePath = join(cwd, file);
			try {
				if (!statSync(filePath).isFile()) return `### ${file}\n(not a regular file)`;
				return `### ${file}\n${readFileSync(filePath, "utf-8")}`;
			} catch (error) {
				return `### ${file}\n(unable to read untracked file: ${(error as Error).message})`;
			}
		})
		.join("\n\n");
}

function countUnstagedFiles(cwd: string, untrackedFiles: string[]): number {
	return uniqueSorted([
		...lines(git(cwd, ["diff", "--name-only", "--", "."]).stdout),
		...untrackedFiles,
	]).length;
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
	return uniqueSorted(getPorcelainEntries(cwd).map((entry) => entry.path));
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
	const statusEntries = getPorcelainEntries(cwd);
	const untrackedFiles = getUntrackedFilesFromEntries(statusEntries);

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
			"## untracked files",
			buildUntrackedFilesContext(cwd, untrackedFiles),
			"",
			"## git status --porcelain=v1 -z",
			formatPorcelainEntries(statusEntries),
		].join("\n"),
		changedFiles: uniqueSorted(statusEntries.map((entry) => entry.path)),
		stagedCount: countChangedFiles(cwd, ["diff", "--cached", "--name-only", "--", "."]),
		unstagedCount: countUnstagedFiles(cwd, untrackedFiles),
	};
}

export function buildBaseReviewTarget(cwd: string, baseRef: string): ReviewTarget {
	const mergeBase = git(cwd, ["merge-base", baseRef, "HEAD"]).stdout.trim();
	if (!mergeBase) throw new Error(`Could not compute merge base for ${baseRef}`);

	const committed = git(cwd, ["diff", `${mergeBase}..HEAD`, "--", "."]).stdout;
	const commits = git(cwd, ["log", "--oneline", `${mergeBase}..HEAD`]).stdout;
	const staged = git(cwd, ["diff", "--cached", "--", "."]).stdout;
	const unstaged = git(cwd, ["diff", "--", "."]).stdout;
	const statusEntries = getPorcelainEntries(cwd);
	const untrackedFiles = getUntrackedFilesFromEntries(statusEntries);
	const files = uniqueSorted([
		...lines(git(cwd, ["diff", "--name-only", `${mergeBase}..HEAD`, "--", "."]).stdout),
		...statusEntries.map((entry) => entry.path),
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
			"## untracked files",
			buildUntrackedFilesContext(cwd, untrackedFiles),
			"",
			"## git status --porcelain=v1 -z",
			formatPorcelainEntries(statusEntries),
		].join("\n"),
		changedFiles: files,
		stagedCount: countChangedFiles(cwd, ["diff", "--cached", "--name-only", "--", "."]),
		unstagedCount: countUnstagedFiles(cwd, untrackedFiles),
		baseRef,
		mergeBase,
	};
}
