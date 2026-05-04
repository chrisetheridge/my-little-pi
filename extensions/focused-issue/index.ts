import type { BeforeAgentStartEventResult, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { createLinearProvider } from "./linear.ts";
import {
	buildFocusedIssueMessage,
	formatFocusedIssueContext,
	formatPendingIssueContext,
	shouldInjectPending,
	shouldInjectReady,
} from "./prompt.ts";
import { FocusedIssueController, restoreFocusedIssueSnapshot } from "./state.ts";
import {
	FOCUSED_ISSUE_STATE_TYPE,
	FOCUSED_ISSUE_WIDGET_KEY,
	type FocusedIssueSnapshot,
	type FocusedIssueState,
	type IssueProvider,
} from "./types.ts";
import { makeFocusedIssueWidgetFactory, renderFocusedIssuePlainLines } from "./ui.ts";

const COMMANDS = ["clear", "refresh", "show", "inject"];

function getSessionEntries(ctx: ExtensionContext): unknown[] {
	const manager = ctx.sessionManager as {
		getBranch?: () => unknown[];
		getEntries?: () => unknown[];
	};
	return manager.getBranch?.() ?? manager.getEntries?.() ?? [];
}

function summarizeState(state: FocusedIssueState): string {
	if (state.status === "idle") return "No focused issue.";
	if (state.issue) {
		const lines = renderFocusedIssuePlainLines(state);
		return lines.length ? lines.join("\n") : `Focused issue: ${state.issue.key} ${state.issue.title}`;
	}
	if (state.error) return `Focused issue ${state.reference ?? ""}: ${state.error.message}`;
	return `Focused issue ${state.reference ?? ""}: ${state.status}`;
}

function updateWidget(ctx: ExtensionContext | undefined, controller: FocusedIssueController): void {
	if (!ctx?.hasUI) return;
	const state = controller.getState();
	if (state.status === "idle") {
		ctx.ui.setWidget(FOCUSED_ISSUE_WIDGET_KEY, undefined, { placement: "aboveEditor" });
		return;
	}
	ctx.ui.setWidget(FOCUSED_ISSUE_WIDGET_KEY, makeFocusedIssueWidgetFactory(() => controller.getState()), {
		placement: "aboveEditor",
	});
}

function notifyError(ctx: ExtensionContext | undefined, state: FocusedIssueState): void {
	if (!ctx?.hasUI || state.status !== "error" || !state.error) return;
	ctx.ui.notify(`focused issue: ${state.error.message}`, state.error.retryable ? "warning" : "error");
}

function persist(pi: ExtensionAPI, snapshot: FocusedIssueSnapshot): void {
	pi.appendEntry(FOCUSED_ISSUE_STATE_TYPE, snapshot);
}

function buildBeforeAgentStartResult(controller: FocusedIssueController): BeforeAgentStartEventResult | undefined {
	const state = controller.getState();
	if (shouldInjectReady(state) && state.issue) {
		const message = buildFocusedIssueMessage(formatFocusedIssueContext(state.issue), controller.toSnapshot());
		controller.markReadyInjected();
		return { message };
	}
	if (shouldInjectPending(state)) {
		const message = buildFocusedIssueMessage(formatPendingIssueContext(state), controller.toSnapshot());
		controller.markPendingInjected();
		return { message };
	}
	return undefined;
}

export function createFocusedIssueExtension(providers: IssueProvider[]): (pi: ExtensionAPI) => void {
	return function focusedIssueExtension(pi: ExtensionAPI): void {
		let lastCtx: ExtensionContext | undefined;
		const controller = new FocusedIssueController({
			providers,
			onChange: (state) => {
				updateWidget(lastCtx, controller);
				notifyError(lastCtx, state);
			},
			onPersist: (snapshot) => persist(pi, snapshot),
		});

		const focusReference = (args: string, ctx: ExtensionContext, alias = false): void => {
			lastCtx = ctx;
			const reference = args.trim();
			if (!reference) {
				ctx.ui.notify(alias ? "usage: /set-focused-issue <issue-ref>" : "usage: /focus-issue <issue-ref|clear|refresh|show|inject>", "warning");
				return;
			}
			controller.setFocus(reference);
			updateWidget(ctx, controller);
			const state = controller.getState();
			if (state.status !== "error") {
				ctx.ui.notify(`focused issue set: ${reference}`, "info");
			}
		};

		pi.registerCommand("focus-issue", {
			description: "Set, clear, refresh, or show the focused external issue",
			getArgumentCompletions: (prefix) => {
				const normalized = prefix.trim().toLowerCase();
				return COMMANDS
					.filter((command) => command.startsWith(normalized))
					.map((command) => ({ label: command, value: command }));
			},
			handler: async (args, ctx) => {
				lastCtx = ctx;
				const command = args.trim();
				if (command === "clear") {
					controller.clear();
					updateWidget(ctx, controller);
					ctx.ui.notify("focused issue cleared", "info");
					return;
				}
				if (command === "refresh" || command === "inject") {
					if (!controller.getState().reference) {
						ctx.ui.notify("no focused issue to refresh", "warning");
						return;
					}
					controller.refresh({ reinject: command === "inject" });
					updateWidget(ctx, controller);
					ctx.ui.notify(command === "inject" ? "focused issue will be reinjected after refresh" : "focused issue refresh started", "info");
					return;
				}
				if (command === "show") {
					ctx.ui.notify(summarizeState(controller.getState()), "info");
					return;
				}
				focusReference(command, ctx);
			},
		});

		pi.registerCommand("set-focused-issue", {
			description: "Set the focused external issue",
			handler: async (args, ctx) => focusReference(args, ctx, true),
		});

		pi.on("session_start", (_event, ctx) => {
			lastCtx = ctx;
			controller.restore(restoreFocusedIssueSnapshot(getSessionEntries(ctx)));
			updateWidget(ctx, controller);
		});

		pi.on("session_shutdown", () => {
			controller.cancel();
		});

		pi.on("before_agent_start", () => buildBeforeAgentStartResult(controller));
	};
}

export default createFocusedIssueExtension([createLinearProvider()]);
