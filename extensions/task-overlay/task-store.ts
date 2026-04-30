import { cloneTask, normalizeTaskStatus, slugifyTaskTitle, type TaskEvent, type TaskItem, type TaskPatch, type TaskStatus } from "./task-types.ts";

type Listener = () => void;

function now(): number {
	return Date.now();
}

function clonePatch(patch: TaskPatch): TaskPatch {
	return { ...patch };
}

function normalizeTitle(value: unknown): string {
	return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function cloneAndPrepareTask(task: TaskItem, fallbackOrder: number, updatedAt = now()): TaskItem {
	return {
		...task,
		id: task.id.trim(),
		title: normalizeTitle(task.title) || "Untitled task",
		status: normalizeTaskStatus(task.status),
		order: Number.isFinite(task.order) ? task.order : fallbackOrder,
		source: task.source?.trim() || "planner",
		sourceRef: task.sourceRef?.trim() || undefined,
		parentId: task.parentId?.trim() || undefined,
		notes: task.notes?.trim() || undefined,
		updatedAt: Number.isFinite(task.updatedAt) ? task.updatedAt : updatedAt,
	};
}

function compareTasks(a: TaskItem, b: TaskItem): number {
	if (a.order !== b.order) return a.order - b.order;
	if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;
	return a.id.localeCompare(b.id);
}

function deriveId(title: string, existingIds: Set<string>, index: number): string {
	const base = `task-${slugifyTaskTitle(title)}`;
	let candidate = base;
	let suffix = 2;
	while (existingIds.has(candidate)) {
		candidate = `${base}-${suffix}`;
		suffix += 1;
	}
	if (!existingIds.has(candidate)) return candidate;
	return `${candidate}-${index + 1}`;
}

export class TaskStore {
	private readonly tasks = new Map<string, TaskItem>();
	private readonly listeners = new Set<Listener>();
	private revision = 0;
	private currentTaskId: string | null = null;
	private lastActivity: string | null = null;

	constructor(initial: TaskItem[] = []) {
		this.replace(initial, true);
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	getRevision(): number {
		return this.revision;
	}

	getCurrentTaskId(): string | null {
		return this.currentTaskId;
	}

	getLastActivity(): string | null {
		return this.lastActivity;
	}

	isEmpty(): boolean {
		return this.tasks.size === 0;
	}

	snapshot(): TaskItem[] {
		return Array.from(this.tasks.values()).map(cloneTask).sort(compareTasks);
	}

	replace(tasks: TaskItem[], silent = false): void {
		this.tasks.clear();
		const ids = new Set<string>();
		tasks.forEach((task, index) => {
			const prepared = cloneAndPrepareTask(task, index);
			ids.add(prepared.id);
			this.tasks.set(prepared.id, prepared);
		});
		this.revision += 1;
		this.reconcileCurrentTask();
		this.lastActivity = tasks.length > 0 ? `Replaced ${tasks.length} task${tasks.length === 1 ? "" : "s"}` : "Cleared tasks";
		if (!silent) this.emit();
	}

	merge(tasks: TaskItem[]): void {
		this.upsert(tasks);
	}

	upsert(tasks: TaskItem[] | TaskItem): void {
		const list = Array.isArray(tasks) ? tasks : [tasks];
		let changed = false;
		const existingIds = new Set(this.tasks.keys());
		let nextOrder = this.nextOrder();
		for (const [index, task] of list.entries()) {
			const title = normalizeTitle(task.title);
			const id = task.id?.trim() || deriveId(title, existingIds, index);
			existingIds.add(id);
			const existing = this.tasks.get(id);
			const order = Number.isFinite(task.order) ? task.order : existing?.order ?? nextOrder;
			const prepared = cloneAndPrepareTask(
				{
					...task,
					id,
					title: title || existing?.title || "Untitled task",
					order,
					updatedAt: Number.isFinite(task.updatedAt) ? task.updatedAt : now(),
					source: task.source || existing?.source || "planner",
				},
				order,
			);
			if (!existing || JSON.stringify(existing) !== JSON.stringify(prepared)) {
				this.tasks.set(id, prepared);
				changed = true;
			}
			nextOrder = Math.max(nextOrder, prepared.order + 1);
		}
		if (changed) {
			this.revision += 1;
			this.reconcileCurrentTask();
			this.lastActivity = `Upserted ${list.length} task${list.length === 1 ? "" : "s"}`;
			this.emit();
		}
	}

	patch(id: string, patch: TaskPatch): void {
		const existing = this.tasks.get(id);
		if (!existing) return;
		const updated: TaskItem = {
			...existing,
			...clonePatch(patch),
			id,
			title: patch.title !== undefined ? normalizeTitle(patch.title) || existing.title : existing.title,
			status: patch.status ? normalizeTaskStatus(patch.status) : existing.status,
			source: patch.source?.trim() || existing.source,
			sourceRef: patch.sourceRef !== undefined ? patch.sourceRef.trim() || undefined : existing.sourceRef,
			parentId: patch.parentId !== undefined ? patch.parentId.trim() || undefined : existing.parentId,
			notes: patch.notes !== undefined ? patch.notes.trim() || undefined : existing.notes,
			order: patch.order !== undefined && Number.isFinite(patch.order) ? patch.order : existing.order,
			updatedAt: patch.updatedAt ?? now(),
		};
		this.tasks.set(id, updated);
		this.revision += 1;
		this.reconcileCurrentTask();
		this.lastActivity = `Updated ${updated.title}`;
		this.emit();
	}

	complete(id: string, note?: string): void {
		this.patch(id, { status: "done", notes: note });
	}

	block(id: string, note?: string): void {
		this.patch(id, { status: "blocked", notes: note });
	}

	activate(id: string, note?: string): void {
		this.currentTaskId = id;
		this.patch(id, { status: "in_progress", notes: note });
	}

	remove(id: string): void {
		if (!this.tasks.delete(id)) return;
		this.revision += 1;
		this.reconcileCurrentTask();
		this.lastActivity = `Removed ${id}`;
		this.emit();
	}

	applyEvent(event: TaskEvent): void {
		switch (event.kind) {
			case "replace":
				this.replace(event.tasks);
				return;
			case "merge":
				this.upsert(event.tasks);
				return;
			case "patch":
				this.patch(event.id, event.patch);
				return;
			case "remove":
				this.remove(event.id);
				return;
			case "activate":
				this.activate(event.id, event.note);
				return;
		}
	}

	replaceById(task: TaskItem): void {
		this.tasks.set(task.id, cloneTask(task));
		this.revision += 1;
		this.reconcileCurrentTask();
		this.emit();
	}

	private nextOrder(): number {
		const snapshot = this.snapshot();
		return snapshot.length > 0 ? snapshot[snapshot.length - 1]!.order + 1 : 0;
	}

	private reconcileCurrentTask(): void {
		if (this.currentTaskId && this.tasks.has(this.currentTaskId)) {
			return;
		}
		const active = this.snapshot().find((task) => task.status === "in_progress");
		this.currentTaskId = active?.id ?? null;
	}

	private emit(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}

export function createTaskStore(initial: TaskItem[] = []): TaskStore {
	return new TaskStore(initial);
}
