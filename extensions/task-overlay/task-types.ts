export type TaskStatus = "pending" | "in_progress" | "blocked" | "done" | "cancelled";

export interface TaskItem {
	id: string;
	title: string;
	status: TaskStatus;
	order: number;
	source: string;
	sourceRef?: string;
	parentId?: string;
	notes?: string;
	updatedAt: number;
}

export interface TaskPatch {
	title?: string;
	status?: TaskStatus;
	source?: string;
	sourceRef?: string;
	parentId?: string;
	notes?: string;
	order?: number;
	updatedAt?: number;
}

export type TaskEvent =
	| { kind: "replace"; tasks: TaskItem[] }
	| { kind: "merge"; tasks: TaskItem[] }
	| { kind: "patch"; id: string; patch: TaskPatch }
	| { kind: "remove"; id: string }
	| { kind: "activate"; id: string; note?: string };

export const TASK_OVERLAY_CUSTOM_TYPE = "task-overlay";

export function isTaskStatus(value: unknown): value is TaskStatus {
	return value === "pending" || value === "in_progress" || value === "blocked" || value === "done" || value === "cancelled";
}

export function normalizeTaskStatus(value: unknown): TaskStatus {
	if (isTaskStatus(value)) return value;
	if (typeof value === "boolean") return value ? "done" : "pending";
	if (typeof value === "number") return value > 0 ? "done" : "pending";
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase().replace(/[\s_-]+/g, "_");
		if (normalized === "todo" || normalized === "open" || normalized === "pending") return "pending";
		if (normalized === "doing" || normalized === "doing_now" || normalized === "active" || normalized === "in_progress") return "in_progress";
		if (normalized === "blocked" || normalized === "waiting") return "blocked";
		if (normalized === "done" || normalized === "complete" || normalized === "completed" || normalized === "shipped") return "done";
		if (normalized === "cancelled" || normalized === "canceled") return "cancelled";
	}
	return "pending";
}

export function statusSymbol(status: TaskStatus): string {
	switch (status) {
		case "done":
			return "✓";
		case "in_progress":
			return "~";
		case "blocked":
			return "!";
		case "cancelled":
			return "×";
		default:
			return " ";
	}
}

export function statusLabel(status: TaskStatus): string {
	switch (status) {
		case "done":
			return "done";
		case "in_progress":
			return "active";
		case "blocked":
			return "blocked";
		case "cancelled":
			return "cancelled";
		default:
			return "pending";
	}
}

export function slugifyTaskTitle(title: string): string {
	const base = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return base || "task";
}

export function cloneTask(task: TaskItem): TaskItem {
	return {
		...task,
	};
}

export function isTaskItem(value: unknown): value is Partial<TaskItem> {
	return !!value && typeof value === "object";
}
