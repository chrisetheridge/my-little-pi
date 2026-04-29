import { truncateToWidth, type Component } from "@mariozechner/pi-tui";

import { statusSymbol, type TaskItem } from "./task-types.ts";
import { type TaskStore } from "./task-store.ts";

interface ThemeLike {
	fg(kind: string, text: string): string;
	bold?(text: string): string;
	dim?(text: string): string;
}

const PADDING = "  ";

export class TaskPanel implements Component {
	private readonly unsubscribe: () => void;

	constructor(
		private readonly store: TaskStore,
		private readonly theme: ThemeLike,
		private readonly requestRender: () => void,
		private readonly onClose?: () => void,
	) {
		this.unsubscribe = store.subscribe(() => {
			this.requestRender();
		});
	}

	invalidate(): void {
		this.requestRender();
	}

	dispose(): void {
		this.unsubscribe();
	}

	handleInput(data: string): void {
		if (data === "\u001b" || data === "escape" || data === "q") {
			this.onClose?.();
		}
	}

	render(width: number): string[] {
		if (width <= 0) return [];

		const innerWidth = Math.max(0, width - PADDING.length);
		const tasks = this.store.snapshot();
		const active = tasks.filter((task) => task.status === "in_progress");
		const doneCount = tasks.filter((task) => task.status === "done").length;
		const headerText = `Tasks ${tasks.length} total • ${active.length} active • ${doneCount} done`;
		const header = this.padLine(this.styleHeader(truncateToWidth(headerText, innerWidth)));

		if (tasks.length === 0) {
			return [header, "", this.padLine(truncateToWidth("No tasks yet. Use tasks sync to load a plan.", innerWidth))];
		}

		const lines = [header, ""];
		const summary = truncateToWidth(`${tasks.length} total • ${active.length} active • ${doneCount} done`, innerWidth);
		lines.push(this.padLine(this.theme.fg("dim", summary)));

		for (const task of tasks) {
			lines.push(this.padLine(this.renderTaskLine(task, innerWidth)));
		}

		const activity = this.store.getLastActivity();
		if (activity) {
			lines.push(this.padLine(this.theme.fg("dim", truncateToWidth(activity, innerWidth))));
		}

		return lines;
	}

	private padLine(text: string): string {
		return `${PADDING}${text}`;
	}

	private styleHeader(text: string): string {
		if (this.theme.bold) return this.theme.bold(text);
		return this.theme.fg("accent", text);
	}

	private renderTaskLine(task: TaskItem, width: number): string {
		const prefix = task.status === "in_progress" ? "▶" : " ";
		const status = statusSymbol(task.status);
		const source = task.source ? ` (${task.source})` : "";
		const title = task.title || "Untitled task";
		const raw = `${prefix} [${status}] ${title}${source}`;
		const line = truncateToWidth(raw, width);
		if (task.status === "done") return this.theme.fg("success", line);
		if (task.status === "blocked") return this.theme.fg("warning", line);
		if (task.status === "in_progress") return this.theme.fg("accent", line);
		if (task.status === "cancelled") return this.theme.fg("muted", line);
		return line;
	}
}
