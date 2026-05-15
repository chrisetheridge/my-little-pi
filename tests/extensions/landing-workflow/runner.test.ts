import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { LandingWorkflowRunner, type ProcessSpawner } from "../../../extensions/landing-workflow/runner.ts";
import type { RunnerEvent } from "../../../extensions/landing-workflow/types.ts";

class FakeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  killedWith?: NodeJS.Signals;
  kill(signal: NodeJS.Signals): boolean {
    this.killedWith = signal;
    this.emit("close", null, signal);
    return true;
  }
}

type Call = { command: string; args: string[]; process: FakeProcess };

function fakeSpawner(): { spawn: ProcessSpawner; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    spawn: (command, args) => {
      const process = new FakeProcess();
      calls.push({ command, args, process });
      return process as any;
    },
  };
}

function close(process: FakeProcess, code: number, stdout = "", stderr = ""): void {
  if (stdout) process.stdout.emit("data", Buffer.from(stdout));
  if (stderr) process.stderr.emit("data", Buffer.from(stderr));
  process.emit("close", code, null);
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("landing workflow runner", () => {
  it("runs shell steps through shell -lc in cwd", async () => {
    const fake = fakeSpawner();
    const events: RunnerEvent[] = [];
    const runner = new LandingWorkflowRunner({ steps: [{ type: "shell", label: "Echo", command: "echo hi" }] }, "/repo", (event) => events.push(event), { spawn: fake.spawn, shell: "/bin/zsh" });
    const promise = runner.run();
    await tick();
    expect(fake.calls[0]).toMatchObject({ command: "/bin/zsh", args: ["-lc", "echo hi"] });
    close(fake.calls[0].process, 0, "hi\n");
    await promise;
    expect(events.map((event) => event.type)).toContain("workflow-success");
  });

  it("emits stdout and stderr into one output stream", async () => {
    const fake = fakeSpawner();
    const output: string[] = [];
    const runner = new LandingWorkflowRunner({ steps: [{ type: "shell", label: "Mix", command: "mix" }] }, "/repo", (event) => {
      if (event.type === "output") output.push(event.text);
    }, { spawn: fake.spawn });
    const promise = runner.run();
    await tick();
    fake.calls[0].process.stdout.emit("data", Buffer.from("out"));
    fake.calls[0].process.stderr.emit("data", Buffer.from("err"));
    close(fake.calls[0].process, 0);
    await promise;
    expect(output.join("")).toContain("outerr");
  });

  it("stops after non-zero shell exit", async () => {
    const fake = fakeSpawner();
    const events: RunnerEvent[] = [];
    const runner = new LandingWorkflowRunner({ steps: [
      { type: "shell", label: "Fail", command: "false" },
      { type: "shell", label: "Skip", command: "echo skip" },
    ] }, "/repo", (event) => events.push(event), { spawn: fake.spawn });
    const promise = runner.run();
    await tick();
    close(fake.calls[0].process, 2);
    await promise;
    expect(fake.calls).toHaveLength(1);
    expect(events.map((event) => event.type)).toContain("workflow-failed");
  });

  it("cancel sends SIGTERM to active child", async () => {
    const fake = fakeSpawner();
    const events: RunnerEvent[] = [];
    const runner = new LandingWorkflowRunner({ steps: [{ type: "shell", label: "Sleep", command: "sleep 10" }] }, "/repo", (event) => events.push(event), { spawn: fake.spawn });
    const promise = runner.run();
    await tick();
    runner.cancel();
    await promise;
    expect(fake.calls[0].process.killedWith).toBe("SIGTERM");
    expect(events.map((event) => event.type)).toContain("workflow-canceled");
  });

  it("commit step fails when no changes are staged after add", async () => {
    const fake = fakeSpawner();
    const events: RunnerEvent[] = [];
    const runner = new LandingWorkflowRunner({ steps: [{ type: "commit", label: "Commit", model: "sonnet" }] }, "/repo", (event) => events.push(event), { spawn: fake.spawn });
    const promise = runner.run();
    await tick();
    close(fake.calls[0].process, 0);
    await tick();
    close(fake.calls[1].process, 0);
    await promise;
    expect(events.find((event) => event.type === "workflow-failed")).toMatchObject({ error: "No changes staged after git add -A" });
  });

  it("commit step gathers context, calls pi model, writes temp file, and commits", async () => {
    const fake = fakeSpawner();
    const files: string[] = [];
    const runner = new LandingWorkflowRunner({ steps: [{ type: "commit", label: "Commit", model: "sonnet" }] }, "/repo", () => {}, { spawn: fake.spawn, makeTempFile: (content) => { files.push(content); return "/tmp/msg"; } });
    const promise = runner.run();
    for (const [index, response] of [
      [0, ""],
      [1, ""],
      [2, " M file.ts\n"],
      [3, " file.ts | 1 +\n"],
      [4, "diff --git a/file.ts b/file.ts\n"],
      [5, "feat: land workflow\n"],
      [6, "[main abc] feat\n"],
    ] as const) {
      await tick();
      close(fake.calls[index].process, index === 1 ? 1 : 0, response);
    }
    await promise;
    expect(fake.calls.map((call) => [call.command, call.args.slice(0, 4)])).toEqual([
      ["git", ["add", "-A"]],
      ["git", ["diff", "--cached", "--quiet"]],
      ["git", ["status", "--short"]],
      ["git", ["diff", "--cached", "--stat"]],
      ["git", ["diff", "--cached"]],
      ["pi", ["-p", "--no-session", "--model", "sonnet"]],
      ["git", ["commit", "-F", "/tmp/msg"]],
    ]);
    expect(files).toEqual(["feat: land workflow\n"]);
  });

  it("empty agent commit output fails", async () => {
    const fake = fakeSpawner();
    const events: RunnerEvent[] = [];
    const runner = new LandingWorkflowRunner({ steps: [{ type: "commit", label: "Commit", model: "sonnet" }] }, "/repo", (event) => events.push(event), { spawn: fake.spawn });
    const promise = runner.run();
    for (const [index, code] of [[0, 0], [1, 1], [2, 0], [3, 0], [4, 0], [5, 0]] as const) {
      await tick();
      close(fake.calls[index].process, code, "");
    }
    await promise;
    expect(events.find((event) => event.type === "workflow-failed")).toMatchObject({ error: "Commit message generator returned an empty response." });
  });
});
