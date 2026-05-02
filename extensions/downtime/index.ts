import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { getAgentDir, type ExtensionAPI, type ExtensionContext, type Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi, type Component } from "@mariozechner/pi-tui";

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

function formatFooterLabel(config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean): string {
	const base = `${config.statusLabel} ${window.label}`;
	if (!window.active) return base;
	return confirmed ? `${base} confirmed` : `${base} active`;
}

function updateFooterStatus(ctx: ExtensionContext, config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean): void {
	if (!ctx.hasUI) return;
	if (!window.active) {
		ctx.ui.setStatus(DOWNTIME_CUSTOM_TYPE, undefined);
		return;
	}

	const role = confirmed ? "success" : "warning";
	ctx.ui.setStatus(DOWNTIME_CUSTOM_TYPE, ctx.ui.theme.fg(role, formatFooterLabel(config, window, confirmed)));
}

function buildPolicyMessage(config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean): string {
	const lines = [
		`## Downtime Policy`,
		`Downtime is active (${window.label} local time).`,
		confirmed
			? "The user has already confirmed continuation for this window."
			: "No continuation confirmation has been recorded for this window yet.",
		`If the user wants to keep working, require the exact confirmation command first: ${config.confirmCommand}`,
	];

	if (config.message.trim()) {
		lines.push("");
		lines.push(config.message.trim());
	}

	return lines.join("\n");
}

function buildSystemPrompt(config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean): string {
	const lines = [
		`Downtime is active for the current local window (${window.label}).`,
		confirmed
			? "The user has already confirmed continuation for this window, so you may help them while still nudging them to rest."
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
		"Accept to continue this work session, or press Escape and go to bed.",
	].join("\n\n");
}

function buildStatusMessage(config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean): string {
	return [
		`Downtime ${window.active ? "active" : "inactive"} (${window.label}).`,
		confirmed ? "Continuation has been confirmed for this window." : "Continuation has not been confirmed yet.",
		`Confirmation command: ${config.confirmCommand}`,
	].join("\n");
}

function buildEndedMessage(window: DowntimeWindow): string {
	return `Downtime ended at ${formatClock(window.end.getHours() * 60 + window.end.getMinutes())}. The guard is disabled until the next window.`;
}

function sendStatusMessage(pi: ExtensionAPI, config: DowntimeConfig, window: DowntimeWindow, confirmed: boolean): void {
	pi.sendMessage({
		customType: DOWNTIME_CUSTOM_TYPE,
		content: buildStatusMessage(config, window, confirmed),
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

function addRightPaddedLine(line: string, width: number): string {
	const clipped = truncateToWidth(line, width);
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

class DowntimeOverlayDialog implements Component {
	private selected = 0;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly title: string,
		private readonly message: string,
		private readonly theme: Theme,
		private readonly done: (result: DowntimeOverlayResult) => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.left) || matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
			this.selected = this.selected === 0 ? 1 : 0;
			this.invalidate();
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
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

		const boxWidth = Math.max(32, width);
		const innerWidth = Math.max(20, boxWidth - 4);
		const lines: string[] = [];
		const push = (line = "") => lines.push(`| ${addRightPaddedLine(line, innerWidth)} |`);
		const title = this.theme.fg("warning", this.title);
		const accept = this.selected === 0 ? this.theme.fg("success", "[ Accept and continue ]") : "[ Accept and continue ]";
		const escape = this.selected === 1 ? this.theme.fg("warning", "[ Escape and go to bed ]") : "[ Escape and go to bed ]";

		lines.push(`+${"-".repeat(boxWidth - 2)}+`);
		push(title);
		push();
		for (const paragraph of this.message.split(/\n\n+/)) {
			for (const line of wrapTextWithAnsi(paragraph, innerWidth)) {
				push(line);
			}
			push();
		}
		push(`${accept}  ${escape}`);
		lines.push(`+${"-".repeat(boxWidth - 2)}+`);

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
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
			(_tui, theme, _keybindings, done) =>
				new DowntimeOverlayDialog("Downtime is active", buildOverlayMessage(config, window), theme, done),
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
			ctx.ui.notify("Downtime remains active. Work was not continued.", "warning");
			updateFooterStatus(ctx, config, window, false);
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
			state.announcedWindowKey = null;
			state.wasActive = false;
		}
		const confirmed = state.confirmedWindowKey === window.key;
		updateFooterStatus(ctx, config, window, confirmed);
		if (window.active && !confirmed) {
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
			return { action: "continue" };
		}

		confirmDowntimeWindow(pi, ctx, state, config, window, false);

		return { action: "continue" };
	});

	pi.registerCommand("downtime", {
		description: "Show or confirm the current downtime schedule",
		handler: async (args, ctx) => {
			const config = loadDowntimeConfig(pi, ctx.cwd);
			const now = new Date();
			const window = getWindow(now, config);
			const confirmed = state.confirmedWindowKey === window.key;
			const action = normalizeWhitespace(args).toLowerCase();

			if (!action || action === "status") {
				sendStatusMessage(pi, config, window, confirmed);
				updateFooterStatus(ctx, config, window, confirmed);
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
		let confirmed = state.confirmedWindowKey === window.key;

		if (!window.active) {
			updateFooterStatus(ctx, config, window, false);

			if (state.wasActive || state.announcedWindowKey) {
				state.confirmedWindowKey = null;
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

		updateFooterStatus(ctx, config, window, confirmed);

		if (!confirmed) {
			confirmed = await requestDowntimeConfirmation(pi, ctx, state, config, window);
		}

		const systemPrompt = `${_event.systemPrompt}\n\n## Downtime\n${buildSystemPrompt(config, window, confirmed)}`;

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
					content: buildPolicyMessage(config, window, confirmed),
					display: false,
					details: {
						kind: "policy",
						active: true,
						confirmed,
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
