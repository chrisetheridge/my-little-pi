import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	buildBaseReviewTarget,
	buildCommitReviewTarget,
	buildUncommittedReviewTarget,
	detectBaseRef,
	getPorcelainFiles,
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

	it("includes untracked file contents and counts them as unstaged", () => {
		const cwd = makeRepo();
		writeFileSync(join(cwd, "scratch.txt"), "untracked content\n", "utf-8");

		const target = buildUncommittedReviewTarget(cwd);

		expect(target.changedFiles).toEqual(["scratch.txt"]);
		expect(target.stagedCount).toBe(0);
		expect(target.unstagedCount).toBe(1);
		expect(target.promptContext).toContain("## untracked files");
		expect(target.promptContext).toContain("scratch.txt");
		expect(target.promptContext).toContain("untracked content");
	});

	it("expands untracked directories to nested files in review context", () => {
		const cwd = makeRepo();
		mkdirSync(join(cwd, "src"));
		writeFileSync(join(cwd, "src", "new-file.ts"), "export const value = 1;\n", "utf-8");

		const uncommittedTarget = buildUncommittedReviewTarget(cwd);
		expect(uncommittedTarget.changedFiles).toContain("src/new-file.ts");
		expect(uncommittedTarget.changedFiles).not.toContain("src/");
		expect(uncommittedTarget.unstagedCount).toBe(1);
		expect(uncommittedTarget.promptContext).toContain("src/new-file.ts");
		expect(uncommittedTarget.promptContext).toContain("export const value = 1;");

		const baseTarget = buildBaseReviewTarget(cwd, "main");
		expect(baseTarget.changedFiles).toContain("src/new-file.ts");
		expect(baseTarget.changedFiles).not.toContain("src/");
		expect(baseTarget.unstagedCount).toBe(1);
		expect(baseTarget.promptContext).toContain("src/new-file.ts");
		expect(baseTarget.promptContext).toContain("export const value = 1;");
	});

	it("preserves paths with spaces from porcelain status", () => {
		const cwd = makeRepo();
		writeFileSync(join(cwd, "file with spaces.txt"), "content\n", "utf-8");

		expect(getPorcelainFiles(cwd)).toEqual(["file with spaces.txt"]);
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
		expect(target.promptContext).toContain("dirty");
	});

	it("builds a commit target for a specific commit", () => {
		const cwd = makeRepo();
		writeFileSync(join(cwd, "README.md"), "hello\nsecond\n", "utf-8");
		run(cwd, ["commit", "-am", "second"]);
		const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" }).stdout.trim();

		const target = buildCommitReviewTarget(cwd, commit);

		expect(target.mode).toBe("commit");
		expect(target.commitRef).toBe(commit);
		expect(target.changedFiles).toEqual(["README.md"]);
		expect(target.promptContext).toContain("git show");
		expect(target.promptContext).toContain("second");
	});
});
