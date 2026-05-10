import { describe, expect, it, vi } from "vitest";

import { FocusedIssueController, restoreFocusedIssueSnapshot } from "../extensions/focused-issue/state.ts";
import type { FocusedIssue, IssueProvider, IssueProviderResult } from "../extensions/focused-issue/types.ts";

function makeIssue(key = "ENG-123"): FocusedIssue {
	return {
		providerId: "linear",
		id: "issue-id",
		key,
		title: "Add focused issue extension",
		labels: [],
		pullRequests: [],
	};
}

function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((innerResolve) => {
		resolve = innerResolve;
	});
	return { promise, resolve };
}

function makeProvider(result: Promise<IssueProviderResult>): IssueProvider {
	return {
		id: "linear",
		label: "Linear",
		canHandle: (reference) => /^[A-Z]+-\d+$/.test(reference),
		fetchIssue: vi.fn((_reference, _signal) => result),
	};
}

describe("FocusedIssueController", () => {
	it("sets focus and resolves metadata asynchronously", async () => {
		const pending = deferred<IssueProviderResult>();
		const provider = makeProvider(pending.promise);
		const changes: string[] = [];
		const persisted: unknown[] = [];
		const controller = new FocusedIssueController({
			providers: [provider],
			onChange: (state) => changes.push(state.status),
			onPersist: (state) => persisted.push(state),
			now: () => 123,
		});

		controller.setFocus("ENG-123");
		expect(controller.getState()).toMatchObject({ status: "loading", reference: "ENG-123" });
		expect(provider.fetchIssue).toHaveBeenCalledTimes(1);

		pending.resolve({ ok: true, issue: makeIssue() });
		await pending.promise;
		await Promise.resolve();

		expect(controller.getState()).toMatchObject({
			status: "ready",
			fetchedAt: 123,
			issue: { key: "ENG-123" },
		});
		expect(changes).toEqual(["loading", "ready"]);
		expect(persisted).toHaveLength(2);
	});

	it("reports unsupported references without fetching", () => {
		const provider = makeProvider(Promise.resolve({ ok: true, issue: makeIssue() }));
		const controller = new FocusedIssueController({ providers: [provider] });

		controller.setFocus("not an issue");

		expect(provider.fetchIssue).not.toHaveBeenCalled();
		expect(controller.getState()).toMatchObject({
			status: "error",
			error: { code: "unsupported" },
		});
	});

	it("cancels in-flight fetches when focus changes", () => {
		const pending = deferred<IssueProviderResult>();
		const signals: AbortSignal[] = [];
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn((_reference, signal) => {
				signals.push(signal);
				return pending.promise;
			}),
		};
		const controller = new FocusedIssueController({ providers: [provider] });

		controller.setFocus("ENG-123");
		controller.setFocus("PLAT-987");

		expect(signals[0]?.aborted).toBe(true);
		expect(signals[1]?.aborted).toBe(false);
	});

	it("ignores superseded fetch results", async () => {
		const first = deferred<IssueProviderResult>();
		const second = deferred<IssueProviderResult>();
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise),
		};
		const controller = new FocusedIssueController({ providers: [provider] });

		controller.setFocus("ENG-123");
		controller.setFocus("PLAT-987");
		first.resolve({ ok: true, issue: makeIssue("ENG-123") });
		second.resolve({ ok: true, issue: makeIssue("PLAT-987") });
		await first.promise;
		await second.promise;
		await Promise.resolve();

		expect(controller.getState().issue?.key).toBe("PLAT-987");
	});

	it("refreshes ready state as stale and records errors", async () => {
		const first = deferred<IssueProviderResult>();
		const second = deferred<IssueProviderResult>();
		const provider: IssueProvider = {
			id: "linear",
			label: "Linear",
			canHandle: () => true,
			fetchIssue: vi.fn()
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise),
		};
		const controller = new FocusedIssueController({ providers: [provider] });

		controller.setFocus("ENG-123");
		first.resolve({ ok: true, issue: makeIssue() });
		await first.promise;
		await Promise.resolve();
		controller.refresh();
		expect(controller.getState().status).toBe("stale");
		second.resolve({
			ok: false,
			error: { code: "network", message: "offline", retryable: true },
		});
		await second.promise;
		await Promise.resolve();

		expect(controller.getState()).toMatchObject({
			status: "error",
			issue: { key: "ENG-123" },
			error: { message: "offline" },
		});
	});

	it("restores the latest replayable snapshot", () => {
		const snapshot = {
			status: "ready" as const,
			reference: "ENG-123",
			providerId: "linear",
			issue: makeIssue(),
			error: null,
			version: 2,
			lastInjectedVersion: 1,
			pendingInjectedVersion: 0,
			fetchedAt: 456,
		};
		const restored = restoreFocusedIssueSnapshot([
			{ type: "custom", customType: "something-else", data: {} },
			{ type: "custom", customType: "focused-issue-state", data: snapshot },
		]);
		const controller = new FocusedIssueController({ providers: [] });

		controller.restore(restored);

		expect(controller.getState()).toMatchObject({
			status: "ready",
			reference: "ENG-123",
			issue: { key: "ENG-123" },
		});
	});
});
