import { Type } from "typebox";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { TASK_OVERLAY_CUSTOM_TYPE, type TaskEvent, type TaskItem, type TaskPatch, type TaskStatus } from "./task-types.ts";
import { normalizeTaskInput, summarizeTaskList } from "./task-normalize.ts";
import { TaskPanel } from "./task-panel.ts";
import { TaskStore, createTaskStore } from "./task-store.ts";

const TASK_PANEL_KEY = "tasks";
const TASK_PANEL_SHORTCUT = "ctrl+shift+t";
const TASK_COMMAND_COMPLETIONS = [
	{ value: "clear", label: "clear", description: "Clear all tasks" },
	{ value: "clear-all", label: "clear-all", description: "Clear all tasks" },
];

const TASK_TOOL_PARAMS = Type.Object({
	operation: Type.Union([
		Type.Literal("sync"),
		Type.Literal("upsert"),
		Type.Literal("update"),
		Type.Literal("complete"),
		Type.Literal("block"),
		Type.Literal("remove"),
		Type.Literal("activate"),
		Type.Literal("clear"),
		Type.Literal("snapshot"),
		Type.Literal("show"),
		Type.Literal("hide"),
	]),
	input: Type.Optional(Type.Any()),
	task: Type.Optional(Type.Any()),
	tasks: Type.Optional(Type.Any()),
	taskId: Type.Optional(Type.String()),
	note: Type.Optional(Type.String()),
	source: Type.Optional(Type.String()),
	sourceRef: Type.Optional(Type.String()),
	replace: Type.Optional(Type.Boolean()),
	open: Type.Optional(Type.Boolean()),
});

type TaskToolParams = {
	operation: string;
	input?: unknown;
	task?: unknown;
	tasks?: unknown;
	taskId?: string;
	note?: string;
	source?: string;
	sourceRef?: string;
	replace?: boolean;
	open?: boolean;
};

interface RuntimeState {
	store: TaskStore;
	panelHandle?: {
		setHidden?(hidden: boolean): void;
		hide?(): void;
		focus?(): void;
		isHidden?(): boolean;
	};
	panelPromise?: Promise<unknown>;
}

const runtimeBySessionManager = new WeakMap<object, RuntimeState>();

function getRuntime(ctx: ExtensionContext): RuntimeState {
	const key = ctx.sessionManager as unknown as object;
	let runtime = runtimeBySessionManager.get(key);
	if (!runtime) {
		runtime = { store: createTaskStore() };
		runtimeBySessionManager.set(key, runtime);
	}
	return runtime;
}

function getOverlayOptions(widthHint = 42): { overlay: true; overlayOptions: any } {
	return {
		overlay: true,
		overlayOptions: {
			anchor: "right-center",
			width: `${widthHint}%`,
			maxHeight: "90%",
			visible: (termWidth: number) => termWidth >= 90,
		},
	};
}

function persistEvent(ctx: ExtensionContext, event: TaskEvent): void {
	const sessionManager = ctx.sessionManager as any;
	if (typeof sessionManager.appendCustomEntry === "function") {
		sessionManager.appendCustomEntry(TASK_OVERLAY_CUSTOM_TYPE, event);
	}
}

function hydrateStoreFromSessionEntries(runtime: RuntimeState, entries: Array<any>): void {
	const store = createTaskStore();
	for (const entry of entries) {
		if (!entry || (entry.type !== "custom" && entry.type !== "custom_message")) continue;
		if (entry.customType !== TASK_OVERLAY_CUSTOM_TYPE) continue;
		const data = entry.data ?? entry.details;
		if (!data || typeof data !== "object") continue;
		store.applyEvent(data as TaskEvent);
	}
	runtime.store = store;
}

function updateFooterStatus(ctx: ExtensionContext, store: TaskStore): void {
	const snapshot = store.snapshot();
	const summary = snapshot.length > 0 ? summarizeTaskList(snapshot) : undefined;
	ctx.ui.setStatus(TASK_PANEL_KEY, summary);
}

function openPanel(ctx: ExtensionContext, runtime: RuntimeState): void {
	if (!ctx.hasUI) return;
	if (runtime.panelHandle?.isHidden?.() === false) {
		runtime.panelHandle.focus?.();
		return;
	}
	if (runtime.panelHandle) {
		runtime.panelHandle.setHidden?.(false);
		runtime.panelHandle.focus?.();
		return;
	}

	const promise = ctx.ui.custom(
		(tui, theme) => new TaskPanel(runtime.store, theme as any, () => tui.requestRender(), () => hidePanel(runtime)),
		{
			...getOverlayOptions(),
			onHandle: (handle) => {
				runtime.panelHandle = handle;
			},
		},
	);

	runtime.panelPromise = Promise.resolve(promise).catch(() => undefined);
}

function hidePanel(runtime: RuntimeState): void {
	runtime.panelHandle?.setHidden?.(true);
	if (!runtime.panelHandle?.setHidden) {
		runtime.panelHandle?.hide?.();
	}
}

function taskById(store: TaskStore, taskId?: string): TaskItem | undefined {
	if (!taskId) return undefined;
	return store.snapshot().find((task) => task.id === taskId);
}

function applySync(runtime: RuntimeState, ctx: ExtensionContext, params: TaskToolParams): string {
	const source = params.source?.trim() || "planner";
	const tasks = normalizeTaskInput(params.input ?? params.tasks ?? params.task ?? [], source, {
		sourceRef: params.sourceRef,
	});
	const event: TaskEvent = {
		kind: params.replace === false ? "merge" : "replace",
		tasks,
	};
	runtime.store.applyEvent(event);
	persistEvent(ctx, event);
	updateFooterStatus(ctx, runtime.store);
	if (params.open) openPanel(ctx, runtime);
	return `synced ${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
}

function applyUpsert(runtime: RuntimeState, ctx: ExtensionContext, params: TaskToolParams): string {
	const source = params.source?.trim() || "agent";
	const tasks = normalizeTaskInput(params.input ?? params.tasks ?? params.task ?? [], source, {
		sourceRef: params.sourceRef,
	});
	const event: TaskEvent = { kind: "merge", tasks };
	runtime.store.applyEvent(event);
	persistEvent(ctx, event);
	updateFooterStatus(ctx, runtime.store);
	if (params.open) openPanel(ctx, runtime);
	return `upserted ${tasks.length} task${tasks.length === 1 ? "" : "s"}`;
}

function applyPatch(runtime: RuntimeState, ctx: ExtensionContext, params: TaskToolParams): string {
	const task = taskById(runtime.store, params.taskId) ?? normalizeTaskInput(params.task, params.source?.trim() || "agent", { sourceRef: params.sourceRef })[0];
	if (!task) return "no matching task";
	const patch: TaskPatch = {
		title: typeof params.task === "object" && params.task ? (params.task as any).title : undefined,
		notes: params.note,
	};
	if (params.operation === "complete") patch.status = "done";
	if (params.operation === "block") patch.status = "blocked";
	if (params.operation === "activate") patch.status = "in_progress";
	if (params.task && typeof params.task === "object") {
		const raw = params.task as Record<string, unknown>;
		patch.title = typeof raw.title === "string" ? raw.title : patch.title;
		patch.status = raw.status ? (raw.status as TaskStatus) : patch.status;
		patch.source = typeof raw.source === "string" ? raw.source : undefined;
		patch.sourceRef = typeof raw.sourceRef === "string" ? raw.sourceRef : undefined;
		patch.parentId = typeof raw.parentId === "string" ? raw.parentId : undefined;
		patch.order = typeof raw.order === "number" ? raw.order : undefined;
		patch.notes = typeof raw.notes === "string" ? raw.notes : patch.notes;
	}
	const event: TaskEvent = { kind: "patch", id: task.id, patch };
	runtime.store.applyEvent(event);
	persistEvent(ctx, event);
	updateFooterStatus(ctx, runtime.store);
	if (params.open) openPanel(ctx, runtime);
	const verb = params.operation === "block" ? "blocked" : params.operation === "activate" ? "activated" : params.operation === "complete" ? "completed" : "updated";
	return `${verb} ${task.title}`;
}

function applyRemove(runtime: RuntimeState, ctx: ExtensionContext, params: TaskToolParams): string {
	const task = taskById(runtime.store, params.taskId) ?? normalizeTaskInput(params.task, params.source?.trim() || "agent", { sourceRef: params.sourceRef })[0];
	if (!task) return "no matching task";
	const event: TaskEvent = { kind: "remove", id: task.id };
	runtime.store.applyEvent(event);
	persistEvent(ctx, event);
	updateFooterStatus(ctx, runtime.store);
	return `removed ${task.title}`;
}

function applyClear(runtime: RuntimeState, ctx: ExtensionContext): string {
	const count = runtime.store.snapshot().length;
	const event: TaskEvent = { kind: "replace", tasks: [] };
	runtime.store.applyEvent(event);
	persistEvent(ctx, event);
	updateFooterStatus(ctx, runtime.store);
	return `cleared ${count} task${count === 1 ? "" : "s"}`;
}

function applySnapshot(runtime: RuntimeState): string {
	const tasks = runtime.store.snapshot();
	if (tasks.length === 0) return "no tasks";
	return tasks.map((task) => `${task.id}: ${task.title} [${task.status}]`).join("\n");
}

async function runTaskCommand(ctx: ExtensionContext, args: string): Promise<void> {
	const runtime = getRuntime(ctx);
	const trimmedArgs = args.trim();
	if (!trimmedArgs) {
		if (runtime.panelHandle?.isHidden?.() === false) {
			hidePanel(runtime);
			return;
		}
		openPanel(ctx, runtime);
		return;
	}
	if (trimmedArgs === "clear" || trimmedArgs === "clear-all") {
		applyClear(runtime, ctx);
		return;
	}
	const text = applySync(runtime, ctx, { operation: "sync", input: args, source: "manual", open: true });
	void text;
}

async function runClearTasksCommand(ctx: ExtensionContext): Promise<void> {
	const runtime = getRuntime(ctx);
	applyClear(runtime, ctx);
}

function getTaskCommandCompletions(prefix: string): Array<{ value: string; label: string; description: string }> | null {
	const normalizedPrefix = prefix.trimStart().toLowerCase();
	const matches = TASK_COMMAND_COMPLETIONS.filter((item) => item.value.startsWith(normalizedPrefix));
	return matches.length > 0 ? matches : null;
}

function executeTaskTool(ctx: ExtensionContext, params: TaskToolParams): string {
	const runtime = getRuntime(ctx);
	switch (params.operation) {
		case "sync":
			return applySync(runtime, ctx, params);
		case "upsert":
			return applyUpsert(runtime, ctx, params);
		case "update":
		case "complete":
		case "block":
		case "activate":
			return applyPatch(runtime, ctx, params);
		case "remove":
			return applyRemove(runtime, ctx, params);
		case "clear":
			return applyClear(runtime, ctx);
		case "snapshot":
			return applySnapshot(runtime);
		case "show":
			openPanel(ctx, runtime);
			return "task panel shown";
		case "hide":
			hidePanel(runtime);
			return "task panel hidden";
		default:
			return "unknown operation";
	}
}

export default function taskOverlayExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "tasks",
		label: "Tasks",
		description: "Sync, update, clear, and inspect the live task panel",
		promptSnippet: "Use the tasks tool to keep work items synchronized with the live task panel.",
		promptGuidelines: [
			"When the work changes, sync or update the canonical task list.",
			"Accept upstream plans in plain JSON, markdown checklists, or simple text.",
			"Keep the task panel aligned with the agent's actual work.",
		],
		parameters: TASK_TOOL_PARAMS,
		executionMode: "parallel",
		renderShell: "default",
		execute: async (_toolCallId, params, _signal, _onUpdate, ctx) => {
			const message = executeTaskTool(ctx, params as TaskToolParams);
			return {
				content: [{ type: "text", text: message }],
				details: { tasks: getRuntime(ctx).store.snapshot() },
			} as any;
		},
	});

	pi.registerCommand("tasks", {
		description: "Open the task overlay, sync tasks when text is provided, or clear tasks with `clear`",
		getArgumentCompletions: getTaskCommandCompletions,
		handler: async (args: string, ctx: ExtensionContext) => {
			await runTaskCommand(ctx, args);
		},
	});

	pi.registerCommand("clear-tasks", {
		description: "Clear all tasks from the task overlay",
		handler: async (_args: string, ctx: ExtensionContext) => {
			await runClearTasksCommand(ctx);
		},
	});

	pi.registerShortcut(TASK_PANEL_SHORTCUT, {
		description: "Toggle the task overlay",
		handler: async (ctx: ExtensionContext) => {
			const runtime = getRuntime(ctx);
			if (runtime.panelHandle?.isHidden?.() === false) {
				hidePanel(runtime);
				return;
			}
			openPanel(ctx, runtime);
		},
	});

	pi.on("session_start", async (event: any, ctx: ExtensionContext) => {
		const runtime = getRuntime(ctx);
		hydrateStoreFromSessionEntries(runtime, ctx.sessionManager.getEntries());
		updateFooterStatus(ctx, runtime.store);
	});

	pi.on("session_shutdown", async (_event: any, ctx: ExtensionContext) => {
		const runtime = getRuntime(ctx);
		hidePanel(runtime);
		ctx.ui.setStatus(TASK_PANEL_KEY, undefined);
	});
}
