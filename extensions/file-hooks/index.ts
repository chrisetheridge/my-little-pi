import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { getAgentDir, type ExtensionAPI, type ExtensionContext, type ToolResultEvent } from "@mariozechner/pi-coding-agent";

interface FileHookRuleConfig {
	name?: string;
	tools?: string[];
	match: string | string[];
	command: string;
	args?: string[];
	cwd?: string;
}

interface FileHooksConfig {
	hooks?: FileHookRuleConfig[];
}

interface FileHookRule {
	name?: string;
	tools: Set<string>;
	matchers: RegExp[];
	command: string;
	args: string[];
	cwd?: string;
}

interface FileHookTarget {
	absolutePath: string;
	relativePath: string;
	displayPath: string;
}

const DEFAULT_TOOL_NAMES = new Set(["write", "edit"]);
const GLOBAL_CONFIG_PATH = join(getAgentDir(), "extensions", "file-hooks.json");
const PROJECT_CONFIG_PATH = join(".pi", "extensions", "file-hooks.json");
const DEFAULT_NOTIFY_LABEL = "file hook";
const STATUS_KEY = "file-hooks";
let executionQueue = Promise.resolve();

function readJsonFile<T>(path: string): T | undefined {
	if (!existsSync(path)) return undefined;
	try {
		return JSON.parse(readFileSync(path, "utf-8")) as T;
	} catch (error) {
		console.error(`Failed to read file hooks config from ${path}: ${error}`);
		return undefined;
	}
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, "/");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
	const normalized = normalizePath(pattern.trim());
	let regex = "^";

	for (let index = 0; index < normalized.length; index++) {
		const char = normalized[index];
		if (char === "*") {
			if (normalized[index + 1] === "*") {
				index++;
				if (normalized[index + 1] === "/") {
					index++;
					regex += "(?:.*/)?";
				} else {
					regex += ".*";
				}
			} else {
				regex += "[^/]*";
			}
			continue;
		}

		if (char === "?") {
			regex += "[^/]";
			continue;
		}

		regex += escapeRegExp(char);
	}

	return new RegExp(`${regex}$`);
}

function toPatternList(pattern: string | string[]): string[] {
	return (Array.isArray(pattern) ? pattern : [pattern]).map((value) => value.trim()).filter(Boolean);
}

function loadConfig(cwd: string): FileHookRule[] {
	const globalConfig = readJsonFile<FileHooksConfig>(GLOBAL_CONFIG_PATH);
	const projectConfig = readJsonFile<FileHooksConfig>(join(cwd, PROJECT_CONFIG_PATH));
	const configs = [globalConfig, projectConfig].filter((config): config is FileHooksConfig => !!config);
	const mergedRules: FileHookRuleConfig[] = [];
	const namedRuleIndex = new Map<string, number>();

	for (const config of configs) {
		for (const rule of config.hooks ?? []) {
			if (!rule || typeof rule.command !== "string" || typeof rule.match === "undefined") continue;
			if (rule.name) {
				const existingIndex = namedRuleIndex.get(rule.name);
				if (existingIndex !== undefined) {
					mergedRules[existingIndex] = rule;
					continue;
				}
				namedRuleIndex.set(rule.name, mergedRules.length);
			}
			mergedRules.push(rule);
		}
	}

	return mergedRules.map((rule) => ({
		name: rule.name,
		tools: new Set((rule.tools?.length ? rule.tools : [...DEFAULT_TOOL_NAMES]).map((tool) => tool.trim()).filter(Boolean)),
		matchers: toPatternList(rule.match).map((pattern) => globToRegExp(pattern)),
		command: rule.command.trim(),
		args: (rule.args ?? []).map((arg) => arg.trim()),
		cwd: rule.cwd?.trim() || undefined,
	}));
}

function getTargetPath(event: ToolResultEvent): string | undefined {
	const path = event.input?.path;
	return typeof path === "string" && path.trim() ? path.trim() : undefined;
}

function resolveTarget(ctx: ExtensionContext, targetPath: string): FileHookTarget {
	const absolutePath = resolve(ctx.cwd, targetPath);
	return {
		absolutePath,
		relativePath: normalizePath(relative(ctx.cwd, absolutePath)),
		displayPath: targetPath,
	};
}

function matchesRule(rule: FileHookRule, target: FileHookTarget): boolean {
	const candidates = [normalizePath(target.relativePath), normalizePath(target.absolutePath)];
	return rule.matchers.some((matcher) => candidates.some((candidate) => matcher.test(candidate)));
}

function renderTemplate(value: string, target: FileHookTarget, ctx: ExtensionContext): string {
	return value
		.replaceAll("{path}", target.relativePath)
		.replaceAll("{relativePath}", target.relativePath)
		.replaceAll("{absolutePath}", target.absolutePath)
		.replaceAll("{cwd}", ctx.cwd)
		.replaceAll("{dir}", normalizePath(relative(ctx.cwd, resolve(target.absolutePath, ".."))))
		.replaceAll("{absoluteDir}", normalizePath(resolve(target.absolutePath, "..")));
}

function resolveCommandCwd(rule: FileHookRule, target: FileHookTarget, ctx: ExtensionContext): string {
	const rendered = renderTemplate(rule.cwd ?? ctx.cwd, target, ctx);
	return resolve(ctx.cwd, rendered);
}

function serializeExecution(task: () => Promise<void>): Promise<void> {
	const next = executionQueue.then(task, task);
	executionQueue = next.then(
		() => undefined,
		() => undefined,
	);
	return next;
}

function shouldHandle(event: ToolResultEvent, rule: FileHookRule): boolean {
	return rule.tools.has(event.toolName);
}

function getRuleLabel(rule: FileHookRule, command: string, args: string[]): string {
	return rule.name ?? `${command} ${args.join(" ")}`.trim();
}

function logHookStart(ctx: ExtensionContext, label: string, target: FileHookTarget): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, `hook ${label}: ${target.displayPath}`);
	ctx.ui.notify(`hook ${label}: ${target.displayPath}`, "info");
}

function clearHookStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, undefined);
}

export default function fileHooksExtension(pi: ExtensionAPI): void {
	pi.on("tool_result", async (event, ctx) => {
		if (event.isError) return;
		const targetPath = getTargetPath(event);
		if (!targetPath) return;

		const target = resolveTarget(ctx, targetPath);
		const rules = loadConfig(ctx.cwd);
		const matchingRules = rules.filter((rule) => shouldHandle(event, rule) && matchesRule(rule, target));
		if (!matchingRules.length) return;

		await serializeExecution(async () => {
			for (const rule of matchingRules) {
				const cwd = resolveCommandCwd(rule, target, ctx);
				const command = renderTemplate(rule.command, target, ctx);
				const args = rule.args.map((arg) => renderTemplate(arg, target, ctx));
				const label = getRuleLabel(rule, command, args);
				logHookStart(ctx, label, target);
				try {
					const result = await pi.exec(command, args, { cwd, signal: ctx.signal });
					if (result.code !== 0) {
						const stderr = result.stderr.trim();
						throw new Error(
							stderr ? `${label} failed for ${target.displayPath}: ${stderr}` : `${label} failed for ${target.displayPath}`,
						);
					}
				} catch (error) {
					console.error(error);
					if (ctx.hasUI) {
						const label = rule.name ?? DEFAULT_NOTIFY_LABEL;
						ctx.ui.notify(`${label} failed for ${target.displayPath}`, "warning");
					}
				} finally {
					clearHookStatus(ctx);
				}
			}
		});
	});
}
