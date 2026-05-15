export type ShellStep = {
  type: "shell";
  label: string;
  command: string;
};

export type CommitStep = {
  type: "commit";
  label: string;
  model: string;
};

export type LandingStep = ShellStep | CommitStep;

export type LandingWorkflowConfig = {
  steps: LandingStep[];
};

export type ConfigLoadResult =
  | { ok: true; config: LandingWorkflowConfig; source: string }
  | { ok: false; error: string; expectedProjectPath: string; source?: string };

export type StepStatus = "pending" | "running" | "success" | "failed" | "canceled";
export type WorkflowStatus = "idle" | "running" | "failed" | "canceled" | "success";

export type StepRunState = {
  step: LandingStep;
  status: StepStatus;
  startedAt?: number;
  endedAt?: number;
  error?: string;
};

export type WorkflowRunState = {
  status: WorkflowStatus;
  steps: StepRunState[];
  output: string[];
  activeAction?: string;
  startedAt?: number;
  endedAt?: number;
  error?: string;
};

export type RunnerEvent =
  | { type: "workflow-start"; at: number }
  | { type: "step-start"; index: number; action: string; at: number }
  | { type: "output"; text: string }
  | { type: "step-success"; index: number; at: number }
  | { type: "step-failed"; index: number; error: string; at: number }
  | { type: "step-canceled"; index: number; at: number }
  | { type: "workflow-success"; at: number }
  | { type: "workflow-failed"; error: string; at: number }
  | { type: "workflow-canceled"; at: number };
