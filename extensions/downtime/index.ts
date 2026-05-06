import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir, type ExtensionAPI, type ExtensionContext, type Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, Box, Text, type Component } from "@mariozechner/pi-tui";

interface DowntimeFileConfig {
	time?: string;
	durationMinutes?: number | string;
	confirmCommand?: string;
	message?: string;
	statusLabel?: string;
}

interface DowntimeConfig {
	time: string;
	timeMinutes: number;
	durationMinutes: number;
	confirmCommand: string;
	message: string;
	statusLabel: string;
	configSource: string;
}

interface DowntimeWindow {
	active: boolean;
	start: Date;
	end: Date;
	key: string;
	label: string;
}

interface DowntimeMessageDetails {
	kind: "policy" | "status" | "ended";
	active: boolean;
	confirmed: boolean;
	windowKey: string | null;
	windowLabel: string;
	confirmCommand: string;
	time: string;
	durationMinutes: number;
	configSource: string;
}

interface DowntimeState {
	confirmedWindowKey: string | null;
	pausedWindowKey: string | null;
	announcedWindowKey: string | null;
	wasActive: boolean;
	pendingConfirmation: Promise<boolean> | null;
}

type DowntimeOverlayResult = "continue" | "escape";

const DEFAULT_CONFIG: DowntimeFileConfig = {
	time: "22:00",
	durationMinutes: 8 * 60,
	confirmCommand: "echo continue-downtime",
	message: "Downtime is active. Pause work unless you intentionally continue with the confirmation command.",
	statusLabel: "downtime",
};

const GLOBAL_CONFIG_PATH = join(getAgentDir(), "extensions", "downtime.json");
const PROJECT_CONFIG_FILE = join(".pi", "extensions", "downtime.json");
const DOWNTIME_CUSTOM_TYPE = "downtime";
const DOWNTIME_CUSTOM_ENTRY_TYPE = "downtime";
const DOWNTIME_FLAG_NAME = "downtime";
let rendererRegistered = false;

function pad2(value: number): string {
	return String(value).padStart(2, "0");
}

function normalizeWhitespace(value: string): string {
	return value.trim().replace(/\s+/g, " ");
}

function readJsonFile<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch (error) {
		console.error(`Failed to read downtime config from ${path}: ${error}`);
		return undefined;
	}
}

function loadFileConfig(cwd: string): { config: DowntimeFileConfig; source: string } {
	const globalConfig = readJsonFile<DowntimeFileConfig>(GLOBAL_CONFIG_PATH) ?? {};
	const projectConfig = readJsonFile<DowntimeFileConfig>(join(cwd, PROJECT_CONFIG_FILE)) ?? {};
	return {
		config: { ...DEFAULT_CONFIG, ...globalConfig, ...projectConfig },
		source: [GLOBAL_CONFIG_PATH, join(cwd, PROJECT_CONFIG_FILE)]
			.filter((path) => existsSync(path))
			.join(", "),
	};
}

function parseTimeOfDay(time: string): number | undefined {
	const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
	if (!match) return undefined;
	const hour = Number(match[1]);
	const minute = Number(match[2]);
	if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
	return hour * 60 + minute;
}

function parseDurationMinutes(value: number | string | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "number") {
		return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
	}
	const normalized = value.trim();
	if (!normalized) return undefined;
	const parsed = Number.parseInt(normalized, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
	return parsed;
}

function formatClock(minutes: number): string {
	const normalized = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
	return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

function formatDateKey(date: Date): string {
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function addMinutes(base: Date, minutes: number): Date {
	return new Date(base.getTime() + minutes * 60_000);
}

function loadDowntimeConfig(pi: ExtensionAPI, cwd: string): DowntimeConfig {
	const fileConfig = loadFileConfig(cwd);
	const flaggedTime = pi.getFlag(DOWNTIME_FLAG_NAME);
	const time = typeof flaggedTime === "string" && flaggedTime.trim() ? flaggedTime.trim() : fileConfig.config.time ?? DEFAULT_CONFIG.time!;
	const durationMinutes = parseDurationMinutes(fileConfig.config.durationMinutes) ?? (DEFAULT_CONFIG.durationMinutes as number);
	const timeMinutes = parseTimeOfDay(time);
	if (timeMinutes === undefined) {
		const fallbackTime = DEFAULT_CONFIG.time as string;
		return {
			time: fallbackTime,
			timeMinutes: parseTimeOfDay(fallbackTime)!,
			durationMinutes: parseDurationMinutes(DEFAULT_CONFIG.durationMinutes) ?? 480,
			confirmCommand: (fileConfig.config.confirmCommand ?? DEFAULT_CONFIG.confirmCommand) as string,
			message: (fileConfig.config.message ?? DEFAULT_CONFIG.message) as string,
			statusLabel: (fileConfig.config.statusLabel ?? DEFAULT_CONFIG.statusLabel) as string,
			configSource: fileConfig.source,
		};
	}

	return {
		time,
		timeMinutes,
		durationMinutes,
		confirmCommand: (fileConfig.config.confirmCommand ?? DEFAULT_CONFIG.confirmCommand) as string,
		message: (fileConfig.config.message ?? DEFAULT_CONFIG.message) as string,
		statusLabel: (fileConfig.config.statusLabel ?? DEFAULT_CONFIG.statusLabel) as string,
		configSource: fileConfig.source,
	};
}

function getWindow(now: Date, config: DowntimeConfig): DowntimeWindow {
	const start = new Date(now);
	start.setHours(0, 0, 0, 0);
	start.setMinutes(config.timeMinutes);

	if (now < start) {
		start.setDate(start.getDate() - 1);
	}

	const end = addMinutes(start, config.durationMinutes);
	const active = now >= start && now < end;
	const label = `${formatClock(config.timeMinutes)}-${formatClock(config.timeMinutes + config.durationMinutes)}`;
	const key = `${formatDateKey(start)}@${formatClock(config.timeMinutes)}`;

	return { active, start, end, key, label };
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildConfirmationMatcher(confirmCommand: string): RegExp {
	const normalized = normalizeWhitespace(confirmCommand);
	if (normalized.toLowerCase().startsWith("echo ")) {
		const rest = normalized.slice(5);
		return new RegExp(`^\\s*echo\\s+['"]?${escapeRegExp(rest)}['"]?\\s*$`, "i");
	}
	return new RegExp(`^\\s*${escapeRegExp(normalized)}\\s*$`, "i");
}

function isConfirmationCommand(command: string, confirmCommand: string): boolean {
	return buildConfirmationMatcher(confirmCommand).test(command);
}

function loadConfirmedWindowKey(entries: Array<any>): string | null {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (!entry || entry.type !== "custom" || entry.customType !== DOWNTIME_CUSTOM_ENTRY_TYPE) continue;
		const confirmedWindowKey = entry.data?.confirmedWindowKey;
		if (typeof confirmedWindowKey === "string" && confirmedWindowKey.trim()) {
			return confirmedWindowKey;
		}
	}
	return null;
}

function formatFooterLabel(config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean, paused: boolean): string {
	const base = `${config.statusLabel} ${window.label}`;
	if (!window.active) return base;
	if (paused) return `${base} paused`;
	return confirmed ? `${base} confirmed` : `${base} active`;
}

function isWindowConfirmed(state: DowntimeState, window: DowntimeWindow): boolean {
	return state.confirmedWindowKey === window.key;
}

function isWindowPaused(state: DowntimeState, window: DowntimeWindow): boolean {
	return state.pausedWindowKey === window.key;
}

function updateFooterStatus(
	ctx: ExtensionContext,
	config: DowntimeConfig,
	window: DowntimeWindow,
	confirmed: boolean,
	paused = false,
): void {
	if (!ctx.hasUI) return;
	if (!window.active) {
		ctx.ui.setStatus(DOWNTIME_CUSTOM_TYPE, undefined);
		return;
	}

	const role = paused ? "muted" : confirmed ? "success" : "warning";
	ctx.ui.setStatus(DOWNTIME_CUSTOM_TYPE, ctx.ui.theme.fg(role, formatFooterLabel(config, window, confirmed, paused)));
}

function buildPolicyMessage(config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean, paused: boolean): string {
	const lines = [
		`## Downtime Policy`,
		paused
			? `Downtime is paused for this window (${window.label} local time).`
			: `Downtime is active (${window.label} local time).`,
		confirmed
			? "The user has already confirmed continuation for this window."
			: paused
				? "The user paused downtime for this window, so do not re-open the confirmation prompt automatically."
				: "No continuation confirmation has been recorded for this window yet.",
		`If the user wants to keep working, require the exact confirmation command first: ${config.confirmCommand}`,
	];

	if (config.message.trim()) {
		lines.push("");
		lines.push(config.message.trim());
	}

	return lines.join("\n");
}

function buildSystemPrompt(config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean, paused: boolean): string {
	const lines = [
		paused
			? `Downtime is paused for the current local window (${window.label}).`
			: `Downtime is active for the current local window (${window.label}).`,
		confirmed
			? "The user has already confirmed continuation for this window, so you may help them while still nudging them to rest."
			: paused
				? "Downtime is paused for this window, so continue without prompting again until the next window."
				: "Do not answer the user as if downtime is normal. A downtime overlay will ask the user whether to accept and continue work before tools run.",
		`Fallback confirmation command: ${config.confirmCommand}`,
	];

	if (config.message.trim()) {
		lines.push(config.message.trim());
	}

	return lines.join("\n");
}

function buildOverlayMessage(config: DowntimeConfig, window: DowntimeWindow): string {
	const configuredMessage = config.message.trim();
	return [
		`Downtime is active (${window.label} local time).`,
		configuredMessage || "This is a configured rest window.",
		"Accept to continue this work session, or press Escape to pause downtime for the rest of this window.",
	].join("\n\n");
}

function buildStatusMessage(config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean, paused: boolean): string {
	return [
		`Downtime ${window.active ? (paused ? "paused" : "active") : "inactive"} (${window.label}).`,
		confirmed
			? "Continuation has been confirmed for this window."
			: paused
				? "Downtime has been paused for the remainder of this window."
				: "Continuation has not been confirmed yet.",
		`Confirmation command: ${config.confirmCommand}`,
	].join("\n");
}

function buildEndedMessage(window: DowntimeWindow): string {
	return `Downtime ended at ${formatClock(window.end.getHours() * 60 + window.end.getMinutes())}. The guard is disabled until the next window.`;
}

function sendStatusMessage(pi: ExtensionAPI, config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean, paused = false): void {
	pi.sendMessage({
		customType: DOWNTIME_CUSTOM_TYPE,
		content: buildStatusMessage(config, window, confirmed, paused),
		display: true,
		details: {
			kind: "status",
			active: window.active,
			confirmed,
			windowKey: window.key,
			windowLabel: window.label,
			confirmCommand: config.confirmCommand,
			time: config.time,
			durationMinutes: config.durationMinutes,
			configSource: config.configSource,
		},
	});
}

function loadConfirmedState(ctx: ExtensionContext): string | null {
	return loadConfirmedWindowKey(ctx.sessionManager.getEntries());
}

class DowntimeOverlayDialog implements Component {
	private selected = 0;
	private readonly box: Box;
	private readonly buttons: Text;

	constructor(
		title: string,
		message: string,
		private readonly theme: Theme,
		private readonly done: (result: DowntimeOverlayResult) => void,
	) {
		this.box = new Box(1, 1, (text) => this.theme.bg("customMessageBg", text));
		this.box.addChild(new Text(this.theme.fg("warning", title), 0, 0));
		this.box.addChild(new Text("", 0, 0));
		this.box.addChild(new Text(this.theme.fg("text", message), 0, 0));
		this.box.addChild(new Text("", 0, 0));
		this.buttons = new Text(this.buildButtons(), 0, 0);
		this.box.addChild(this.buttons);
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
			this.selected = this.selected === 0 ? 1 : 0;
			this.buttons.setText(this.buildButtons());
			this.box.invalidate();
			return;
		}

		if (matchesKey(data, Key.enter)) {
			this.done(this.selected === 0 ? "continue" : "escape");
			return;
		}

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.done("escape");
		}
	}

	render(width: number): string[] {
		return this.box.render(width);
	}

	invalidate(): void {
		this.box.invalidate();
	}

	private buildButtons(): string {
		const accept = this.selected === 0 ? this.theme.fg("success", "[ Accept and continue ]") : "[ Accept and continue ]";
		const pause = this.selected === 1 ? this.theme.fg("warning", "[ Escape and pause downtime ]") : "[ Escape and pause downtime ]";
		return `${accept}  ${pause}`;
	}
}

function confirmDowntimeWindow(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: DowntimeState,
	config: DowntimeConfig,
	window: DowntimeWindow,
	persist: boolean,
): void {
	state.confirmedWindowKey = window.key;
	state.pausedWindowKey = null;
	state.announcedWindowKey = window.key;
	state.wasActive = true;
	if (persist) {
		pi.appendEntry(DOWNTIME_CUSTOM_ENTRY_TYPE, { confirmedWindowKey: window.key });
	}
	if (ctx.hasUI) {
		ctx.ui.notify("Downtime confirmed for this window.", "info");
	}
	updateFooterStatus(ctx, config, window, true);
}

function pauseDowntimeWindow(
	ctx: ExtensionContext,
	state: DowntimeState,
	config: DowntimeConfig,
	window: DowntimeWindow,
): void {
	state.pausedWindowKey = window.key;
	state.announcedWindowKey = window.key;
	state.wasActive = true;
	updateFooterStatus(ctx, config, window, false, true);
	if (ctx.hasUI) {
		ctx.ui.notify("Downtime paused for this window.", "info");
	}
}

async function requestDowntimeConfirmation(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: DowntimeState,
	config: DowntimeConfig,
	window: DowntimeWindow,
): Promise<boolean> {
	if (!ctx.hasUI) return false;
	if (state.pendingConfirmation) return state.pendingConfirmation;

	state.pendingConfirmation = ctx.ui
		.custom<DowntimeOverlayResult>(
			(_tui, theme, _keybindings, done) => {
				const panel = new DowntimeOverlayDialog("Downtime is active", buildOverlayMessage(config, window), theme, done);
				return panel;
			},
			{
				overlay: true,
				overlayOptions: {
					width: "60%",
					minWidth: 46,
					maxHeight: "80%",
					anchor: "center",
					margin: 2,
				},
			},
		)
		.then((result) => {
			if (result === "continue") {
				confirmDowntimeWindow(pi, ctx, state, config, window, true);
				return true;
			}
			pauseDowntimeWindow(ctx, state, config, window);
			return false;
		})
		.finally(() => {
			state.pendingConfirmation = null;
		});

	return state.pendingConfirmation;
}

function registerRenderer(pi: ExtensionAPI): void {
	if (rendererRegistered) return;

	pi.registerMessageRenderer(DOWNTIME_CUSTOM_TYPE, (message, { expanded }, theme) => {
		const details = message.details as DowntimeMessageDetails | undefined;
		const active = details?.active ?? false;
		const confirmed = details?.confirmed ?? false;
		const kind = details?.kind ?? "status";
		const color = kind === "ended" ? "success" : confirmed ? "success" : active ? "warning" : "muted";
		let text = theme.fg(color, kind === "ended" ? "Downtime ended" : kind === "policy" ? "Downtime policy" : "Downtime status");
		text += `\n${message.content}`;

		if (expanded && details) {
			text += `\n${theme.fg("dim", `window: ${details.windowLabel}`)}`;
			text += `\n${theme.fg("dim", `confirmed: ${confirmed ? "yes" : "no"}`)}`;
			text += `\n${theme.fg("dim", `command: ${details.confirmCommand}`)}`;
			text += `\n${theme.fg("dim", `source: ${details.configSource || "default"}`)}`;
		}

		return new Text(text, 0, 0);
	});

	rendererRegistered = true;
}

export default function downtimeExtension(pi: ExtensionAPI): void {
	const state: DowntimeState = {
		confirmedWindowKey: null,
		pausedWindowKey: null,
		announcedWindowKey: null,
		wasActive: false,
		pendingConfirmation: null,
	};

	pi.registerFlag(DOWNTIME_FLAG_NAME, {
		description: "Downtime start time in local HH:MM format",
		type: "string",
	});

	registerRenderer(pi);

	pi.on("session_start", async (_event, ctx) => {
		const config = loadDowntimeConfig(pi, ctx.cwd);
		const window = getWindow(new Date(), config);
		state.confirmedWindowKey = loadConfirmedState(ctx);
		if (!window.active) {
			state.pausedWindowKey = null;
			state.announcedWindowKey = null;
			state.wasActive = false;
		}
		const confirmed = isWindowConfirmed(state, window);
		const paused = isWindowPaused(state, window);
		updateFooterStatus(ctx, config, window, confirmed, paused);
		if (window.active && !confirmed && !paused) {
			await requestDowntimeConfirmation(pi, ctx, state, config, window);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(DOWNTIME_CUSTOM_TYPE, undefined);
	});

	pi.on("input", async (event, ctx) => {
		if (event.source === "extension") {
			return { action: "continue" };
		}

		const config = loadDowntimeConfig(pi, ctx.cwd);
		const window = getWindow(new Date(), config);
		if (!window.active) {
			return { action: "continue" };
		}

		if (!isConfirmationCommand(event.text, config.confirmCommand)) {
			if (isWindowConfirmed(state, window) || isWindowPaused(state, window)) {
				return { action: "continue" };
			}

			const accepted = await requestDowntimeConfirmation(pi, ctx, state, config, window);
			return accepted ? { action: "continue" } : { action: "handled" };
		}

		confirmDowntimeWindow(pi, ctx, state, config, window, false);
		return { action: "handled" };
	});

	pi.registerCommand("downtime", {
		description: "Show or confirm the current downtime schedule",
		handler: async (args, ctx) => {
			const config = loadDowntimeConfig(pi, ctx.cwd);
			const now = new Date();
			const window = getWindow(now, config);
			const confirmed = isWindowConfirmed(state, window);
			const paused = isWindowPaused(state, window);
			const action = normalizeWhitespace(args).toLowerCase();

			if (!action || action === "status") {
				sendStatusMessage(pi, config, window, confirmed, paused);
				updateFooterStatus(ctx, config, window, confirmed, paused);
				return;
			}

			if (action === "confirm") {
				if (!window.active) {
					ctx.ui.notify("Downtime is not active right now.", "warning");
					return;
				}

				if (confirmed) {
					ctx.ui.notify("Downtime is already confirmed for this window.", "info");
					return;
				}

				confirmDowntimeWindow(pi, ctx, state, config, window, true);
				return;
			}

			ctx.ui.notify("Usage: /downtime [status|confirm]", "warning");
		},
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const config = loadDowntimeConfig(pi, ctx.cwd);
		const now = new Date();
		const window = getWindow(now, config);
		const confirmed = isWindowConfirmed(state, window);
		const paused = isWindowPaused(state, window);

		if (!window.active) {
			updateFooterStatus(ctx, config, window, false);
			if (state.wasActive || state.announcedWindowKey) {
				state.confirmedWindowKey = null;
				state.pausedWindowKey = null;
				state.announcedWindowKey = null;
				state.wasActive = false;
				if (ctx.hasUI) {
					ctx.ui.notify(buildEndedMessage(window), "info");
				}
				return {
					message: {
						customType: DOWNTIME_CUSTOM_TYPE,
						content: buildEndedMessage(window),
						display: false,
						details: {
							kind: "ended",
							active: false,
							confirmed: false,
							windowKey: window.key,
							windowLabel: window.label,
							confirmCommand: config.confirmCommand,
							time: config.time,
							durationMinutes: config.durationMinutes,
							configSource: config.configSource,
						},
					},
				};
			}

			return;
		}

		updateFooterStatus(ctx, config, window, confirmed, paused);

		if (paused) {
			state.wasActive = true;
			return { systemPrompt: `${_event.systemPrompt}\n\n## Downtime\n${buildSystemPrompt(config, window, confirmed, paused)}` };
		}

		if (!confirmed) {
			const accepted = await requestDowntimeConfirmation(pi, ctx, state, config, window);
			if (!accepted) return;
		}

		const systemPrompt = `${_event.systemPrompt}\n\n## Downtime\n${buildSystemPrompt(config, window, true, false)}`;

		if (state.announcedWindowKey !== window.key) {
			state.announcedWindowKey = window.key;
			state.wasActive = true;
			if (ctx.hasUI) {
				ctx.ui.notify(`Downtime active (${window.label}).`, "warning");
			}
			return {
				systemPrompt,
				message: {
					customType: DOWNTIME_CUSTOM_TYPE,
					content: buildPolicyMessage(config, window, true, false),
					display: false,
					details: {
						kind: "policy",
						active: true,
						confirmed: true,
						windowKey: window.key,
						windowLabel: window.label,
						confirmCommand: config.confirmCommand,
						time: config.time,
						durationMinutes: config.durationMinutes,
						configSource: config.configSource,
					},
				},
			};
		}

		state.wasActive = true;
		return { systemPrompt };
	});

	pi.on("tool_call", async (event, ctx) => {
		const config = loadDowntimeConfig(pi, ctx.cwd);
		const now = new Date();
		const window = getWindow(now, config);
		if (!window.active) return;

		const confirmed = state.confirmedWindowKey === window.key;
		if (confirmed) return;

		if (event.toolName === "bash") {
			const input = event.input as { command?: unknown } | undefined;
			const command = typeof input?.command === "string" ? input.command : "";
			if (isConfirmationCommand(command, config.confirmCommand)) {
				confirmDowntimeWindow(pi, ctx, state, config, window, true);
				return;
			}
		}

		const accepted = await requestDowntimeConfirmation(pi, ctx, state, config, window);
		if (accepted) return;

		return {
			block: true,
			reason: `Downtime is active (${window.label}). The user dismissed the downtime continuation dialog.`,
		};
	});
}
