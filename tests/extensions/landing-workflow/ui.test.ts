import { describe, expect, it, vi } from "vitest";
import { LandingWorkflowComponent } from "../../../extensions/land/ui.ts";
import type {
  LandingWorkflowConfig,
  RunnerEvent,
} from "../../../extensions/land/types.ts";

const theme = {
  fg: (_name: string, text: string) => text,
  bg: (_name: string, text: string) => text,
} as any;

const config: LandingWorkflowConfig = {
  steps: [
    { type: "shell", label: "Tests", command: "pnpm test" },
    { type: "commit", label: "Commit", model: "sonnet" },
  ],
};

function renderText(component: LandingWorkflowComponent): string {
  return component.render(100).join("\n");
}

describe("landing workflow ui", () => {
  it("idle state renders title, config source, start control, progress, and steps", () => {
    const component = new LandingWorkflowComponent({
      configResult: {
        ok: true,
        source: "/repo/.pi/extensions/land.json",
        config,
      },
      cwd: "/repo",
      theme,
      done: vi.fn(),
      now: () => 0,
    });
    const text = renderText(component);
    expect(text).toContain("Land");
    expect(text).toContain("/repo/.pi/extensions/land");
    expect(text).toContain("Enter Start · Esc Cancel");
    expect(text).toContain("0/2");
    expect(text).toContain("Tests");
    expect(text).toContain("Commit (not started)");
  });

  it("missing config disables start and shows setup instructions", () => {
    const component = new LandingWorkflowComponent({
      configResult: {
        ok: false,
        error: "No land workflow config found",
        expectedProjectPath: "/repo/.pi/extensions/land.json",
      },
      cwd: "/repo",
      theme,
      done: vi.fn(),
    });
    const text = renderText(component);
    expect(text).toContain("Start disabled · Esc Close");
    expect(text).toContain("Expected: /repo/.pi/extensions/land");
  });

  it("running state renders active step, elapsed time, progress, and output", async () => {
    let onEvent: ((event: RunnerEvent) => void) | undefined;
    const component = new LandingWorkflowComponent({
      configResult: { ok: true, source: "source", config },
      cwd: "/repo",
      theme,
      done: vi.fn(),
      now: () => 2000,
      runnerFactory: (_config, _cwd, callback) => {
        onEvent = callback;
        return { run: async () => {}, cancel: vi.fn() };
      },
    });
    component.handleInput("\r");
    onEvent?.({ type: "workflow-start", at: 1000 });
    onEvent?.({ type: "step-start", index: 0, action: "pnpm test", at: 1000 });
    onEvent?.({ type: "output", text: "test output\n" });
    const text = renderText(component);
    expect(text).toContain("Status: RUNNING");
    expect(text).toContain("Current step: Tests");
    expect(text).toContain("test output");
    expect(text).toContain("Elapsed: 0:01");
  });

  it("failed state renders failed status and keeps output visible", () => {
    let onEvent: ((event: RunnerEvent) => void) | undefined;
    const component = new LandingWorkflowComponent({
      configResult: { ok: true, source: "source", config },
      cwd: "/repo",
      theme,
      done: vi.fn(),
      runnerFactory: (_config, _cwd, callback) => {
        onEvent = callback;
        return { run: async () => {}, cancel: vi.fn() };
      },
    });
    component.handleInput("\r");
    onEvent?.({ type: "workflow-start", at: 0 });
    onEvent?.({ type: "step-start", index: 0, action: "pnpm test", at: 0 });
    onEvent?.({ type: "output", text: "failure details\n" });
    onEvent?.({ type: "step-failed", index: 0, error: "boom", at: 1000 });
    onEvent?.({ type: "workflow-failed", error: "boom", at: 1000 });
    const text = renderText(component);
    expect(text).toContain("Status: FAILED");
    expect(text).toContain("failure details");
    expect(text).toContain("Esc Close");
  });

  it("success state renders all steps complete and final controls", () => {
    let onEvent: ((event: RunnerEvent) => void) | undefined;
    const component = new LandingWorkflowComponent({
      configResult: { ok: true, source: "source", config },
      cwd: "/repo",
      theme,
      done: vi.fn(),
      runnerFactory: (_config, _cwd, callback) => {
        onEvent = callback;
        return { run: async () => {}, cancel: vi.fn() };
      },
    });
    component.handleInput("\r");
    onEvent?.({ type: "workflow-start", at: 0 });
    onEvent?.({ type: "step-success", index: 0, at: 1000 });
    onEvent?.({ type: "step-success", index: 1, at: 2000 });
    onEvent?.({ type: "workflow-success", at: 2000 });
    const text = renderText(component);
    expect(text).toContain("Status: SUCCESS");
    expect(text).toContain("2/2");
    expect(text).toContain("Esc Close");
  });

  it("Escape in running state calls cancel and Enter in idle starts", () => {
    const cancel = vi.fn();
    const component = new LandingWorkflowComponent({
      configResult: { ok: true, source: "source", config },
      cwd: "/repo",
      theme,
      done: vi.fn(),
      runnerFactory: (_config, _cwd, callback) => ({
        run: async () => {
          callback({ type: "workflow-start", at: 0 });
          return new Promise(() => {});
        },
        cancel,
      }),
    });
    component.handleInput("\r");
    component.handleInput("\x1b");
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
