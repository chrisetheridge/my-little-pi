import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir, type BeforeAgentStartEventResult, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";

import { extractIssueReference } from "./providers.ts";
import { createLinearProvider } from "./providers/linear.ts";
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
const SCROLL_UP_SHORTCUT = "ctrl+shift+up";
const SCROLL_DOWN_SHORTCUT = "ctrl+shift+down";
const CLOSE_SHORTCUT = "ctrl+shift+w";
const GLOBAL_CONFIG_PATH = join(getAgentDir(), "extensions", "focused-issue.json");
const PROJECT_CONFIG_FILE = join(".pi", "extensions", "focused-issue.json");

interface FocusedIssueConfig {
	autoFocusIssueMentions: boolean;
}

interface FocusedIssueFileConfig {
	autoFocusIssueMentions?: boolean;
}

const DEFAULT_CONFIG: FocusedIssueConfig = {
	autoFocusIssueMentions: true,
};

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

interface FocusedIssueScrollState {
	offset: number;
}

function updateWidget(ctx: ExtensionContext | undefined, controller: FocusedIssueController, scrollState: FocusedIssueScrollState): void {
	if (!ctx?.hasUI) return;
	const state = controller.getState();
	if (state.status === "idle") {
		ctx.ui.setWidget(FOCUSED_ISSUE_WIDGET_KEY, undefined, { placement: "aboveEditor" });
		return;
	}
	ctx.ui.setWidget(
		FOCUSED_ISSUE_WIDGET_KEY,
		makeFocusedIssueWidgetFactory(
			() => controller.getState(),
			Date.now,
			() => scrollState.offset,
			(offset) => {
				scrollState.offset = offset;
			},
		),
		{ placement: "aboveEditor" },
	);
}

function notifyError(ctx: ExtensionContext | undefined, state: FocusedIssueState): void {
	if (!ctx?.hasUI || state.status !== "error" || !state.error) return;
	ctx.ui.notify(`Error focusing issue: ${state.error.message}`, state.error.retryable ? "warning" : "error");
}

function persist(pi: ExtensionAPI, snapshot: FocusedIssueSnapshot): void {
	pi.appendEntry(FOCUSED_ISSUE_STATE_TYPE, snapshot);
}

function readJsonFile<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch (error) {
		console.error(`Failed to read focused issue config from ${path}: ${error}`);
		return undefined;
	}
}

function loadFocusedIssueConfig(cwd: string): FocusedIssueConfig {
	const globalConfig = readJsonFile<FocusedIssueFileConfig>(GLOBAL_CONFIG_PATH) ?? {};
	const projectConfig = readJsonFile<FocusedIssueFileConfig>(join(cwd, PROJECT_CONFIG_FILE)) ?? {};
	return {
		...DEFAULT_CONFIG,
		...globalConfig,
		...projectConfig,
	};
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
		const scrollState: FocusedIssueScrollState = { offset: 0 };
		const resetScroll = (): void => {
			scrollState.offset = 0;
		};
		const scrollWidget = (delta: number, ctx: ExtensionContext): void => {
			if (controller.getState().status === "idle") return;
			lastCtx = ctx;
			scrollState.offset = Math.max(0, scrollState.offset + delta);
			updateWidget(ctx, controller, scrollState);
		};
		const closeWidget = (ctx: ExtensionContext): void => {
			if (controller.getState().status === "idle") return;
			lastCtx = ctx;
			resetScroll();
			controller.clear();
			updateWidget(ctx, controller, scrollState);
		};
		const controller = new FocusedIssueController({
			providers,
			onChange: (state) => {
				updateWidget(lastCtx, controller, scrollState);
				notifyError(lastCtx, state);
			},
			onPersist: (snapshot) => persist(pi, snapshot),
		});

		const focusReference = (args: string, ctx: ExtensionContext): void => {
			lastCtx = ctx;
			const reference = args.trim();
			if (!reference) {
				ctx.ui.notify("Usage: /focus-issue <issue-ref|clear|refresh|show|inject>", "warning");
				return;
			}
			const previousVersion = controller.getState().version;
			resetScroll();
			const nextState = controller.setFocus(reference);
			if (nextState.version !== previousVersion) {
				updateWidget(ctx, controller, scrollState);
			}
		};

		pi.registerShortcut(SCROLL_UP_SHORTCUT, {
			description: "Scroll focused issue up",
			handler: (ctx) => scrollWidget(-1, ctx),
		});
		pi.registerShortcut(SCROLL_DOWN_SHORTCUT, {
			description: "Scroll focused issue down",
			handler: (ctx) => scrollWidget(1, ctx),
		});
		pi.registerShortcut(CLOSE_SHORTCUT, {
			description: "Close focused issue",
			handler: closeWidget,
		});

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
					resetScroll();
					controller.clear();
					updateWidget(ctx, controller, scrollState);
					ctx.ui.notify("Focused issue cleared", "info");
					return;
				}
				if (command === "refresh" || command === "inject") {
					if (!controller.getState().reference) {
						ctx.ui.notify("No focused issue to refresh", "warning");
						return;
					}
					controller.refresh({ reinject: command === "inject" });
					updateWidget(ctx, controller, scrollState);
					ctx.ui.notify(command === "inject" ? "Focused issue will be reinjected after refresh" : "Focused issue refresh started", "info");
					return;
				}
				if (command === "show") {
					ctx.ui.notify(summarizeState(controller.getState()), "info");
					return;
				}
				focusReference(command, ctx);
			},
		});

		pi.on("session_start", (_event, ctx) => {
			lastCtx = ctx;
			resetScroll();
			controller.restore(restoreFocusedIssueSnapshot(getSessionEntries(ctx)));
			updateWidget(ctx, controller, scrollState);
		});

		pi.on("session_shutdown", () => {
			controller.cancel();
		});

		pi.on("input", (event, ctx) => {
			const config = loadFocusedIssueConfig(ctx.cwd);
			if (event.source === "extension" || !config.autoFocusIssueMentions) {
				return { action: "continue" };
			}
			const reference = extractIssueReference(event.text, providers);
			if (!reference || reference === controller.getState().reference) {
				return { action: "continue" };
			}
			lastCtx = ctx;
			resetScroll();
			controller.setFocus(reference);
			updateWidget(ctx, controller, scrollState);
			return { action: "continue" };
		});

		pi.on("before_agent_start", () => buildBeforeAgentStartResult(controller));
	};
}

export default createFocusedIssueExtension([createLinearProvider()]);
