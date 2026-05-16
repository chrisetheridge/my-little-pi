import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import {
  type Component,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@mariozechner/pi-tui";
import { LandingWorkflowRunner } from "./runner.ts";
import type {
  ConfigLoadResult,
  LandingWorkflowConfig,
  RunnerEvent,
  StepRunState,
  WorkflowRunState,
} from "./types.ts";

const CHECK = "✓";
const CROSS = "✗";
const WAIT = "·";
const CANCEL = "■";

export type LandingWorkflowComponentOptions = {
  configResult: ConfigLoadResult;
  cwd: string;
  theme: Theme;
  done: () => void;
  requestRender?: () => void;
  runnerFactory?: (
    config: LandingWorkflowConfig,
    cwd: string,
    onEvent: (event: RunnerEvent) => void,
  ) => Pick<LandingWorkflowRunner, "run" | "cancel">;
  now?: () => number;
};

export class LandingWorkflowComponent implements Component {
  private readonly now: () => number;
  private runner?: Pick<LandingWorkflowRunner, "run" | "cancel">;
  private timer?: NodeJS.Timeout;
  private state: WorkflowRunState;

  constructor(private readonly options: LandingWorkflowComponentOptions) {
    this.now = options.now ?? Date.now;
    this.state = initialState(options.configResult);
  }

  render(width: number): string[] {
    const safeWidth = Math.max(48, width);
    const innerWidth = Math.max(44, safeWidth - 4);
    const lines = this.renderPanel(innerWidth);
    return box(lines, innerWidth, this.options.theme).map((line) => fitLine(line, safeWidth));
  }

  handleInput(data: string): void {
    if (
      matchesKey(data, Key.enter) &&
      this.state.status === "idle" &&
      this.options.configResult.ok
    ) {
      this.start();
      return;
    }
    if (matchesKey(data, Key.escape)) {
      if (this.state.status === "running") {
        this.runner?.cancel();
        return;
      }
      this.dispose();
      this.options.done();
    }
  }

  invalidate(): void {}

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.state.status === "running") this.runner?.cancel();
  }

  start(): void {
    if (!this.options.configResult.ok || this.state.status !== "idle") return;
    const factory =
      this.options.runnerFactory ??
      ((config, cwd, onEvent) => new LandingWorkflowRunner(config, cwd, onEvent));
    this.runner = factory(this.options.configResult.config, this.options.cwd, (event) =>
      this.applyEvent(event),
    );
    this.timer = setInterval(() => this.requestRender(), 120);
    void this.runner.run().finally(() => {
      if (this.timer && this.state.status !== "running") {
        clearInterval(this.timer);
        this.timer = undefined;
      }
      this.requestRender();
    });
  }

  private applyEvent(event: RunnerEvent): void {
    switch (event.type) {
      case "workflow-start":
        this.state.status = "running";
        this.state.startedAt = event.at;
        this.state.endedAt = undefined;
        break;
      case "step-start":
        this.state.steps[event.index].status = "running";
        this.state.steps[event.index].startedAt = event.at;
        this.state.activeAction = event.action;
        break;
      case "output":
        this.state.output.push(...event.text.split(/(?<=\n)/));
        if (this.state.output.length > 1000)
          this.state.output.splice(0, this.state.output.length - 1000);
        break;
      case "step-success":
        this.state.steps[event.index].status = "success";
        this.state.steps[event.index].endedAt = event.at;
        break;
      case "step-failed":
        this.state.steps[event.index].status = "failed";
        this.state.steps[event.index].endedAt = event.at;
        this.state.steps[event.index].error = event.error;
        this.state.error = event.error;
        break;
      case "step-canceled":
        this.state.steps[event.index].status = "canceled";
        this.state.steps[event.index].endedAt = event.at;
        break;
      case "workflow-success":
        this.state.status = "success";
        this.state.endedAt = event.at;
        break;
      case "workflow-failed":
        this.state.status = "failed";
        this.state.error = event.error;
        this.state.endedAt = event.at;
        break;
      case "workflow-canceled":
        this.state.status = "canceled";
        this.state.endedAt = event.at;
        break;
    }
    this.requestRender();
  }

  private requestRender(): void {
    this.options.requestRender?.();
  }

  private renderPanel(width: number): string[] {
    const lines: string[] = [];
    lines.push(this.options.theme.fg("accent", "Land"));
    lines.push(`Current status: ${this.statusText(this.state.status)}`);
    lines.push(
      center(
        `Land  •  Status: ${this.state.status.toUpperCase()}  •  Elapsed: ${formatMs(elapsed(this.state, this.now()))}`,
        width,
      ),
    );
    lines.push("");

    if (this.options.configResult.ok) {
      lines.push(
        this.options.theme.fg("dim", fitLine(`Config: ${this.options.configResult.source}`, width)),
      );
    } else {
      lines.push(this.options.theme.fg("error", "Config missing or invalid"));
      lines.push(...wrap(this.options.configResult.error, width));
      lines.push(fitLine(`Expected: ${this.options.configResult.expectedProjectPath}`, width));
    }
    lines.push("");
    lines.push(
      `${this.options.theme.fg("dim", "Workflow progress")} ${progressBar(completedCount(this.state.steps), this.state.steps.length, Math.max(10, width - 20))}`,
    );
    lines.push("");
    lines.push(this.options.theme.fg("accent", `Current step: ${this.currentStepSummary()}`));
    lines.push("");
    lines.push(this.options.theme.fg("accent", "Steps:"));
    lines.push("");
    for (const step of this.state.steps) {
      lines.push(
        fitLine(
          `${icon(step.status, this.now())} ${step.step.label} ${this.stepStatusText(step)}`,
          width,
        ),
      );
    }

    if (this.state.output.length > 0) {
      lines.push("");
      lines.push(this.options.theme.fg("accent", "Output:"));
      const body = this.state.output.flatMap((line) => wrap(line.replace(/\n$/, ""), width));
      lines.push(...body.slice(-8));
    }

    lines.push("");
    lines.push(this.options.theme.fg("dim", this.footer()));
    return lines.map((line) => fitLine(line, width));
  }

  private currentStepSummary(): string {
    const running = this.state.steps.find((step) => step.status === "running");
    if (!running) return "none";
    const duration = formatStepDuration(running, this.now());
    return duration ? `${running.step.label} (${duration})` : running.step.label;
  }

  private stepStatusText(step: StepRunState): string {
    if (step.status === "pending") return "(not started)";
    if (step.status === "running") return `(${formatStepDuration(step, this.now())})`;
    if (step.status === "success") return `(${formatStepDuration(step, this.now())})`;
    if (step.status === "canceled") return "(canceled)";
    return step.error ? `(failed: ${step.error})` : "(failed)";
  }

  private statusText(status: string): string {
    if (status === "running") return this.options.theme.fg("accent", status.toUpperCase());
    if (status === "failed") return this.options.theme.fg("error", status.toUpperCase());
    return status.toUpperCase();
  }

  private footer(): string {
    if (this.state.status === "idle")
      return this.options.configResult.ok
        ? "Enter Start · Esc Cancel"
        : "Start disabled · Esc Close";
    if (this.state.status === "running") return "Esc Cancel";
    return "Esc Close";
  }
}

export async function showLandingWorkflow(
  ctx: ExtensionCommandContext,
  configResult: ConfigLoadResult,
): Promise<void> {
  let component: LandingWorkflowComponent | undefined;
  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      component = new LandingWorkflowComponent({
        configResult,
        cwd: ctx.cwd,
        theme,
        done: () => done(),
        requestRender: () => tui.requestRender(),
      });
      return component;
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "65%",
        minWidth: 72,
        maxHeight: "82%",
        margin: 1,
      },
    },
  );
  component?.dispose();
}

function initialState(configResult: ConfigLoadResult): WorkflowRunState {
  const steps = configResult.ok
    ? configResult.config.steps.map((step) => ({
        step,
        status: "pending" as const,
      }))
    : [];
  return { status: "idle", steps, output: [] };
}

function completedCount(steps: StepRunState[]): number {
  return steps.filter((step) => step.status === "success").length;
}

function elapsed(state: WorkflowRunState, now: number): number {
  if (!state.startedAt) return 0;
  return (state.endedAt ?? now) - state.startedAt;
}

function formatStepDuration(step: StepRunState, now: number): string {
  if (!step.startedAt) return "";
  return formatMs((step.endedAt ?? now) - step.startedAt);
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function box(lines: string[], width: number, theme: Theme): string[] {
  const top = `┌${"─".repeat(width + 2)}┐`;
  const bottom = `└${"─".repeat(width + 2)}┘`;
  return [
    theme.fg("dim", top),
    ...lines.map((line) => theme.fg("dim", "│ ") + pad(line, width) + theme.fg("dim", " │")),
    theme.fg("dim", bottom),
  ];
}

function center(text: string, width: number): string {
  const fitted = fitLine(text, width);
  const left = Math.max(0, Math.floor((width - visibleWidth(fitted)) / 2));
  return `${" ".repeat(left)}${fitted}`;
}

function progressBar(done: number, total: number, width: number): string {
  if (total === 0) return "[disabled]";
  const barWidth = Math.max(5, width - 8);
  const filled = Math.round((done / total) * barWidth);
  return `${"█".repeat(filled)}${"░".repeat(barWidth - filled)} ${done}/${total}`;
}

function icon(status: string, now: number): string {
  if (status === "success") return CHECK;
  if (status === "failed") return CROSS;
  if (status === "running") {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    return frames[Math.floor(now / 120) % frames.length];
  }
  if (status === "canceled") return CANCEL;
  return WAIT;
}

function wrap(text: string, width: number): string[] {
  const normalized = text.length ? text : "";
  const lines: string[] = [];
  let rest = normalized;
  while (visibleWidth(rest) > width) {
    lines.push(truncateToWidth(rest, width));
    rest = rest.slice(lines[lines.length - 1].length);
  }
  lines.push(rest);
  return lines.length ? lines : [""];
}

function fitLine(text: string, width: number): string {
  return visibleWidth(text) <= width ? text : truncateToWidth(text, width);
}

function pad(text: string, width: number): string {
  const fitted = fitLine(text, width);
  return `${fitted}${" ".repeat(Math.max(0, width - visibleWidth(fitted)))}`;
}
