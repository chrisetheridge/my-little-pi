import { normalizeTaskStatus, slugifyTaskTitle, type TaskItem } from "./task-types.ts";

type TaskInputObject = Record<string, unknown>;

interface NormalizeOptions {
	now?: number;
	sourceRef?: string;
}

function isObject(value: unknown): value is TaskInputObject {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanText(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

function firstString(...values: unknown[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

function parseJsonIfPossible(input: string): unknown {
	const trimmed = input.trim();
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return undefined;
	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return undefined;
	}
}

function buildId(title: string, used: Set<string>): string {
	const base = `task-${slugifyTaskTitle(title)}`;
	if (!used.has(base)) {
		used.add(base);
		return base;
	}
	let suffix = 2;
	let candidate = `${base}-${suffix}`;
	while (used.has(candidate)) {
		suffix += 1;
		candidate = `${base}-${suffix}`;
	}
	used.add(candidate);
	return candidate;
}

function normalizeTaskLike(value: unknown, index: number, source: string, now: number, used: Set<string>, sourceRef?: string): TaskItem | null {
	if (typeof value === "string") {
		const title = value.trim();
		if (!title) return null;
		return {
			id: buildId(title, used),
			title,
			status: "pending",
			order: index,
			source,
			sourceRef,
			updatedAt: now,
		};
	}

	if (!isObject(value)) return null;

	const title = firstString(value.title, value.name, value.text, value.label, value.description, value.task);
	if (!title) return null;

	const id = firstString(value.id) ?? buildId(title, used);
	const status = normalizeTaskStatus(value.status ?? value.state ?? value.done ?? value.completed ?? value.checked);
	const notes = firstString(value.notes, value.note, value.context, value.details);
	const item: TaskItem = {
		id,
		title,
		status,
		order: typeof value.order === "number" && Number.isFinite(value.order) ? value.order : index,
		source: firstString(value.source) ?? source,
		sourceRef: firstString(value.sourceRef, value.planId, value.section) ?? sourceRef,
		parentId: firstString(value.parentId),
		notes,
		updatedAt: typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) ? value.updatedAt : now,
	};
	used.add(item.id);
	return item;
}

function parseChecklistLine(line: string): { title: string; status?: string } | null {
	let current = line.trim();
	if (!current) return null;
	current = current.replace(/^>\s*/, "");
	current = current.replace(/^[-*+•]\s+/, "");
	current = current.replace(/^\d+[.)]\s+/, "");
	const checked = current.match(/^\[(x|X|✓|✔)\]\s+/);
	if (checked) {
		return { title: current.replace(/^\[(x|X|✓|✔)\]\s+/, "").trim(), status: "done" };
	}
	const unchecked = current.match(/^\[\s\]\s+/);
	if (unchecked) {
		return { title: current.replace(/^\[\s\]\s+/, "").trim(), status: "pending" };
	}
	return { title: current.trim(), status: undefined };
}

function parseMarkdownTasks(text: string, source: string, now: number, sourceRef?: string): TaskItem[] {
	const used = new Set<string>();
	const result: TaskItem[] = [];
	const lines = cleanText(text).split("\n");
	for (const [index, line] of lines.entries()) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (/^#{1,6}\s+/.test(trimmed)) continue;
		const parsed = parseChecklistLine(trimmed);
		if (!parsed) continue;
		const title = parsed.title.replace(/\s+/g, " ").trim();
		if (!title) continue;
		const lower = title.toLowerCase();
		if (result.some((task) => task.title.toLowerCase() === lower)) continue;
		result.push({
			id: buildId(title, used),
			title,
			status: normalizeTaskStatus(parsed.status),
			order: result.length,
			source,
			sourceRef,
			updatedAt: now,
		});
	}
	return result;
}

function normalizeArray(input: unknown[], source: string, options: NormalizeOptions): TaskItem[] {
	const now = options.now ?? Date.now();
	const used = new Set<string>();
	const result: TaskItem[] = [];
	for (const [index, item] of input.entries()) {
		const normalized = normalizeTaskLike(item, index, source, now, used, options.sourceRef);
		if (!normalized) continue;
		const key = normalized.title.toLowerCase();
		if (result.some((task) => task.title.toLowerCase() === key)) continue;
		result.push({ ...normalized, order: result.length });
	}
	return result;
}

export function normalizeTaskInput(input: unknown, source: string, options: NormalizeOptions = {}): TaskItem[] {
	const now = options.now ?? Date.now();
	if (typeof input === "string") {
		const parsed = parseJsonIfPossible(input);
		if (parsed !== undefined) return normalizeTaskInput(parsed, source, options);
		return parseMarkdownTasks(input, source, now, options.sourceRef);
	}

	if (Array.isArray(input)) return normalizeArray(input, source, options);

	if (isObject(input)) {
		if (Array.isArray(input.tasks)) return normalizeArray(input.tasks, source, options);
		if (Array.isArray(input.items)) return normalizeArray(input.items, source, options);
		if (Array.isArray(input.taskList)) return normalizeArray(input.taskList, source, options);
		const maybeTask = normalizeTaskLike(input, 0, source, now, new Set<string>(), options.sourceRef);
		return maybeTask ? [maybeTask] : [];
	}

	return [];
}

export function summarizeTaskList(tasks: TaskItem[]): string {
	const counts = {
		pending: 0,
		in_progress: 0,
		blocked: 0,
		done: 0,
		cancelled: 0,
	};
	for (const task of tasks) {
		counts[task.status] += 1;
	}
	const parts: string[] = [`${tasks.length} task${tasks.length === 1 ? "" : "s"}`];
	if (counts.in_progress > 0) parts.push(`${counts.in_progress} active`);
	if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`);
	if (counts.done > 0) parts.push(`${counts.done} done`);
	return parts.join(" • ");
}
