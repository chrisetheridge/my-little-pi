import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LandingStep, LandingWorkflowConfig, RunnerEvent } from "./types.ts";

const MAX_DIFF_CHARS = 60_000;

export type SpawnedProcess = Pick<ChildProcessWithoutNullStreams, "stdout" | "stderr" | "kill"> & {
  stdin: Pick<ChildProcessWithoutNullStreams["stdin"], "end">;
} & {
  on(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
};

export type ProcessSpawner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
) => SpawnedProcess;

export type RunnerDeps = {
  spawn?: ProcessSpawner;
  now?: () => number;
  makeTempFile?: (content: string) => string;
  shell?: string;
};

export class LandingWorkflowRunner {
  private active?: SpawnedProcess;
  private canceled = false;
  private readonly spawnProcess: ProcessSpawner;
  private readonly now: () => number;
  private readonly makeTempFile: (content: string) => string;
  private readonly shell: string;

  constructor(
    private readonly config: LandingWorkflowConfig,
    private readonly cwd: string,
    private readonly onEvent: (event: RunnerEvent) => void,
    deps: RunnerDeps = {},
  ) {
    this.spawnProcess = deps.spawn ?? ((command, args, options) => spawn(command, args, options));
    this.now = deps.now ?? Date.now;
    this.makeTempFile = deps.makeTempFile ?? defaultTempFile;
    this.shell = deps.shell ?? process.env.SHELL ?? "/bin/sh";
  }

  cancel(): void {
    this.canceled = true;
    if (this.active) this.active.kill("SIGTERM");
  }

  async run(): Promise<void> {
    this.onEvent({ type: "workflow-start", at: this.now() });
    for (let index = 0; index < this.config.steps.length; index += 1) {
      const step = this.config.steps[index];
      const action = describeStepAction(step);
      this.onEvent({ type: "step-start", index, action, at: this.now() });
      try {
        if (step.type === "shell") await this.runShellCommand(step.command);
        else await this.runCommitStep(step.model);
      } catch (error) {
        if (this.canceled) {
          this.onEvent({ type: "step-canceled", index, at: this.now() });
          this.onEvent({ type: "workflow-canceled", at: this.now() });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.onEvent({
          type: "step-failed",
          index,
          error: message,
          at: this.now(),
        });
        this.onEvent({
          type: "workflow-failed",
          error: message,
          at: this.now(),
        });
        return;
      }
      if (this.canceled) {
        this.onEvent({ type: "step-canceled", index, at: this.now() });
        this.onEvent({ type: "workflow-canceled", at: this.now() });
        return;
      }
      this.onEvent({ type: "step-success", index, at: this.now() });
    }
    this.onEvent({ type: "workflow-success", at: this.now() });
  }

  private async runCommitStep(model: string): Promise<void> {
    await this.runLogged("git add -A", "git", ["add", "-A"]);
    const quiet = await this.runCapture(
      "git diff --cached --quiet",
      "git",
      ["diff", "--cached", "--quiet"],
      {
        allowExitCodes: [0, 1],
      },
    );
    if (quiet.code === 0) throw new Error("No changes staged after git add -A");
    if (quiet.code !== 1)
      throw new Error(quiet.output.trim() || "git diff --cached --quiet failed");

    const status = await this.runCapture("git status --short", "git", ["status", "--short"]);
    const stat = await this.runCapture("git diff --cached --stat", "git", [
      "diff",
      "--cached",
      "--stat",
    ]);
    const diff = await this.runCapture("git diff --cached", "git", ["diff", "--cached"]);
    const cappedDiff =
      diff.output.length > MAX_DIFF_CHARS
        ? `${diff.output.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated at ${MAX_DIFF_CHARS} chars]`
        : diff.output;

    const prompt = buildCommitPrompt(status.output, stat.output, cappedDiff);
    const agent = await this.runCapture(
      `pi -p --no-session --model ${model} <commit-message-prompt>`,
      "pi",
      ["-p", "--no-session", "--model", model, prompt],
    );
    const message = agent.output.trim();
    if (!message) throw new Error("Commit message generator returned an empty response.");

    const file = this.makeTempFile(message.endsWith("\n") ? message : `${message}\n`);
    await this.runLogged(`git commit -F ${file}`, "git", ["commit", "-F", file]);
  }

  private async runShellCommand(command: string): Promise<void> {
    await this.runLogged(command, this.shell, ["-lc", command]);
  }

  private async runLogged(label: string, command: string, args: string[]): Promise<void> {
    this.onEvent({ type: "output", text: `$ ${label}\n` });
    const result = await this.runProcess(command, args, { emitOutput: true });
    if (result.code !== 0) throw new Error(`${label} exited with code ${result.code}`);
  }

  private async runCapture(
    label: string,
    command: string,
    args: string[],
    options: { allowExitCodes?: number[] } = {},
  ): Promise<{ code: number; output: string }> {
    this.onEvent({ type: "output", text: `$ ${label}\n` });
    const result = await this.runProcess(command, args, { emitOutput: true });
    const allowed = options.allowExitCodes ?? [0];
    if (!allowed.includes(result.code)) {
      throw new Error(result.output.trim() || `${label} exited with code ${result.code}`);
    }
    return result;
  }

  private runProcess(
    command: string,
    args: string[],
    options: { emitOutput: boolean },
  ): Promise<{ code: number; output: string }> {
    return new Promise((resolve, reject) => {
      const child = this.spawnProcess(command, args, {
        cwd: this.cwd,
        env: process.env,
      });
      this.active = child;
      let settled = false;
      let output = "";
      const append = (chunk: Buffer | string) => {
        const text = chunk.toString();
        output += text;
        if (options.emitOutput) this.onEvent({ type: "output", text });
      };
      child.stdout.on("data", append);
      child.stderr.on("data", append);
      child.stdin.end();
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        this.active = undefined;
        reject(error);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        this.active = undefined;
        resolve({ code: code ?? (this.canceled ? 143 : 1), output });
      });
    });
  }
}

export function describeStepAction(step: LandingStep): string {
  return step.type === "shell" ? step.command : `agent commit (${step.model})`;
}

export function buildCommitPrompt(status: string, stat: string, diff: string): string {
  return [
    "Generate a concise git commit message for the staged changes.",
    "Use Conventional Commits format. Return only the commit message, with optional body if useful.",
    "",
    "## git status --short",
    status.trim() || "(empty)",
    "",
    "## git diff --cached --stat",
    stat.trim() || "(empty)",
    "",
    "## git diff --cached",
    diff.trim() || "(empty)",
  ].join("\n");
}

function defaultTempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "land-"));
  const file = join(dir, "COMMIT_EDITMSG");
  writeFileSync(file, content, "utf-8");
  process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
  return file;
}
