import { describe, expect, it } from "vitest";

import { normalizeTaskInput } from "./task-normalize.ts";

describe("task normalization", () => {
	it("parses markdown checklists and infers done state", () => {
		const tasks = normalizeTaskInput(
			"- [ ] Draft plan\n- [x] Implement panel\n1. Verify output\n",
			"planner",
			{ now: 10 },
		);

		expect(tasks).toEqual([
			expect.objectContaining({ id: "task-draft-plan", title: "Draft plan", status: "pending", source: "planner", order: 0, updatedAt: 10 }),
			expect.objectContaining({ id: "task-implement-panel", title: "Implement panel", status: "done", source: "planner", order: 1, updatedAt: 10 }),
			expect.objectContaining({ id: "task-verify-output", title: "Verify output", status: "pending", source: "planner", order: 2, updatedAt: 10 }),
		]);
	});

	it("normalizes structured JSON tasks without a specialized planner format", () => {
		const tasks = normalizeTaskInput(
			{
				tasks: [
					{ name: "Sync tasks", done: true, sourceRef: "upstream-plan" },
					{ id: "explicit-id", title: "Keep explicit ids", status: "blocked", notes: "blocked by design" },
				],
			},
			"upstream",
			{ now: 20 },
		);

		expect(tasks).toEqual([
			expect.objectContaining({ id: "task-sync-tasks", title: "Sync tasks", status: "done", source: "upstream", sourceRef: "upstream-plan", order: 0, updatedAt: 20 }),
			expect.objectContaining({ id: "explicit-id", title: "Keep explicit ids", status: "blocked", source: "upstream", notes: "blocked by design", order: 1, updatedAt: 20 }),
		]);
	});

	it("deduplicates repeated checklist items", () => {
		const tasks = normalizeTaskInput("- Repeated\n- Repeated\n- Repeated", "planner", { now: 30 });
		expect(tasks.map((task) => task.title)).toEqual(["Repeated"]);
	});
});
