import { describe, expect, it, vi } from "vitest";

import { TaskPanel } from "./task-panel.ts";
import { createTaskStore } from "./task-store.ts";

function theme() {
	return {
		fg: (_kind: string, text: string) => text,
		bold: (text: string) => `*${text}*`,
		dim: (text: string) => text,
	};
}

describe("task panel", () => {
	it("renders the current task list with status markers", () => {
		const store = createTaskStore([
			{ id: "a", title: "Draft plan", status: "pending", order: 0, source: "planner", updatedAt: 1 },
			{ id: "b", title: "Implement panel", status: "in_progress", order: 1, source: "agent", updatedAt: 2 },
			{ id: "c", title: "Ship", status: "done", order: 2, source: "agent", updatedAt: 3 },
		]);
		const panel = new TaskPanel(store, theme(), () => {});

			expect(panel.render(80)).toEqual([
				"  *Tasks 3 total • 1 active • 1 done*",
				"",
				"  3 total • 1 active • 1 done",
				"    [ ] Draft plan (planner)",
				"  ▶ [~] Implement panel (agent)",
				"    [✓] Ship (agent)",
				"  Replaced 3 tasks",
			]);
	});

	it("requests a render when the store changes", () => {
		const store = createTaskStore([
			{ id: "a", title: "Draft plan", status: "pending", order: 0, source: "planner", updatedAt: 1 },
		]);
		const requestRender = vi.fn();
		new TaskPanel(store, theme(), requestRender);

		store.complete("a");

		expect(requestRender).toHaveBeenCalled();
	});
});
