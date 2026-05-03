import { describe, expect, it } from "vitest";
import {
	buildPullRequestReviewTarget,
	ensureCleanWorktree,
	restoreOriginalRef,
	type GitCommandResult,
	type GitCommandRunner,
} from "./extensions/review/git.ts";

function ok(stdout = ""): GitCommandResult {
	return { ok: true, stdout, stderr: "" };
}

function fail(stderr = "failed"): GitCommandResult {
	return { ok: false, stdout: "", stderr };
}

function makeRunner(responses: Record<string, GitCommandResult>): {
	commands: string[];
	runner: GitCommandRunner;
} {
	const commands: string[] = [];
	const runner: GitCommandRunner = (_cwd, command, args) => {
		const key = [command, ...args].join(" ");
		commands.push(key);
		return responses[key] ?? fail(`unexpected command: ${key}`);
	};
	return { commands, runner };
}

describe("review PR git helpers", () => {
	it("requires a clean worktree before PR checkout", () => {
		const { runner } = makeRunner({
			"git status --porcelain": ok(" M README.md\n"),
		});

		expect(() => ensureCleanWorktree("/repo", runner)).toThrow(
			"PR review requires a clean worktree before checkout.",
		);
	});

	it("builds a pull request target after checkout", () => {
		const prUrl = "https://github.com/example/project/pull/123";
		const { commands, runner } = makeRunner({
			"git status --porcelain": ok(""),
			"git branch --show-current": ok("main\n"),
			[`gh pr checkout ${prUrl}`]: ok("Switched to branch 'feature'\n"),
			[`gh pr diff ${prUrl} --name-only`]: ok("README.md\nsrc/review.ts\n"),
			[`gh pr diff ${prUrl} --patch`]: ok("diff --git a/README.md b/README.md\n"),
		});

		const target = buildPullRequestReviewTarget("/repo", prUrl, runner);

		expect(commands).toEqual([
			"git status --porcelain",
			"git branch --show-current",
			`gh pr checkout ${prUrl}`,
			`gh pr diff ${prUrl} --name-only`,
			`gh pr diff ${prUrl} --patch`,
		]);
		expect(commands).not.toContain("git diff --name-only main...HEAD -- .");
		expect(commands).not.toContain("git diff main...HEAD -- .");
		expect(target.mode).toBe("pr");
		expect(target.prUrl).toBe(prUrl);
		expect(target.originalRef).toBe("main");
		expect(target.changedFiles).toEqual(["README.md", "src/review.ts"]);
		expect(target.promptContext).toContain(prUrl);
		expect(target.promptContext).toContain("Original ref: main");
		expect(target.promptContext).toContain("## gh pr diff --patch");
		expect(target.promptContext).toContain("diff --git a/README.md b/README.md");
	});

	it("restores the original ref when PR diff building fails after checkout", () => {
		const prUrl = "https://github.com/example/project/pull/123";
		const { commands, runner } = makeRunner({
			"git status --porcelain": ok(""),
			"git branch --show-current": ok("main\n"),
			[`gh pr checkout ${prUrl}`]: ok("Switched to branch 'feature'\n"),
			[`gh pr diff ${prUrl} --name-only`]: fail("could not read PR diff"),
			"git checkout main": ok("Switched to branch 'main'\n"),
		});

		expect(() => buildPullRequestReviewTarget("/repo", prUrl, runner)).toThrow("could not read PR diff");
		expect(commands).toEqual([
			"git status --porcelain",
			"git branch --show-current",
			`gh pr checkout ${prUrl}`,
			`gh pr diff ${prUrl} --name-only`,
			"git checkout main",
		]);
	});

	it("restores the original ref", () => {
		const { commands, runner } = makeRunner({
			"git checkout main": ok("Switched to branch 'main'\n"),
		});

		expect(restoreOriginalRef("/repo", "main", runner)).toBe(true);
		expect(commands).toEqual(["git checkout main"]);
	});
});
