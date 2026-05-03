import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { normalize as normalizePosixPath } from "node:path/posix";

export type FindingSeverity = "critical" | "high" | "medium" | "low";
export type FindingStatus = "open" | "ignored";

export interface RawFinding {
	id?: string;
	severity?: string;
	file?: string;
	startLine?: number;
	startColumn?: number;
	endLine?: number;
	endColumn?: number;
	title?: string;
	explanation?: string;
	suggestedFix?: string;
}

export interface ReviewFinding {
	id: string;
	severity: FindingSeverity;
	file: string;
	startLine: number;
	startColumn?: number;
	endLine?: number;
	endColumn?: number;
	title: string;
	explanation: string;
	suggestedFix: string;
	status: FindingStatus;
}

export interface ParsedFindings {
	summary: string;
	findings: RawFinding[];
}

export interface SourceExcerptLine {
	number: number;
	text: string;
	selected: boolean;
}

export interface SourceExcerpt {
	available: boolean;
	message?: string;
	lines: SourceExcerptLine[];
}

const severities = new Set<FindingSeverity>(["critical", "high", "medium", "low"]);

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSeverity(severity: string | undefined): FindingSeverity {
	const normalized = severity?.trim().toLowerCase();
	if (normalized && severities.has(normalized as FindingSeverity)) {
		return normalized as FindingSeverity;
	}
	return "medium";
}

function validateOptionalStringField(finding: Record<string, unknown>, field: keyof RawFinding): void {
	if (finding[field] !== undefined && typeof finding[field] !== "string") {
		throw new Error(`Finding ${field} must be a string.`);
	}
}

function validateOptionalNumberField(finding: Record<string, unknown>, field: keyof RawFinding): void {
	if (finding[field] !== undefined && typeof finding[field] !== "number") {
		throw new Error(`Finding ${field} must be a number.`);
	}
}

function validateRawFindingSchema(value: unknown, index: number): RawFinding {
	if (!isObject(value)) {
		throw new Error(`Finding at index ${index} must be an object.`);
	}

	for (const field of ["id", "severity", "file", "title", "explanation", "suggestedFix"] as const) {
		validateOptionalStringField(value, field);
	}
	for (const field of ["startLine", "startColumn", "endLine", "endColumn"] as const) {
		validateOptionalNumberField(value, field);
	}

	return value;
}

function normalizeRelativeFile(file: string | undefined): string {
	if (typeof file !== "string") {
		throw new Error("Finding file is required.");
	}

	const trimmed = file.trim();
	if (!trimmed) {
		throw new Error("Finding file is required.");
	}
	if (trimmed.includes("\0") || isAbsolute(trimmed) || /^[A-Za-z]:/.test(trimmed)) {
		throw new Error(`Finding file must be a relative workspace path: ${trimmed}`);
	}

	const normalized = normalizePosixPath(trimmed.replaceAll("\\", "/"));
	if (
		!normalized ||
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		normalized.startsWith("/")
	) {
		throw new Error(`Finding file must stay inside the workspace: ${trimmed}`);
	}

	return normalized;
}

function requireNonEmptyString(value: string | undefined, field: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new Error(`Finding ${field} is required.`);
	}
	return value.trim();
}

function requireLine(value: number | undefined, field: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new Error(`Finding ${field} must be an integer >= 1.`);
	}
	return value;
}

function optionalPositiveInteger(value: number | undefined, field: string): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`Finding ${field} must be an integer >= 1.`);
	}
	return value;
}

function stableFindingId(finding: Omit<ReviewFinding, "id" | "severity" | "suggestedFix" | "status">): string {
	const hash = createHash("sha1")
		.update([
			finding.file,
			String(finding.startLine),
			finding.startColumn === undefined ? "" : String(finding.startColumn),
			finding.endLine === undefined ? "" : String(finding.endLine),
			finding.endColumn === undefined ? "" : String(finding.endColumn),
			finding.title,
			finding.explanation,
		].join("\0"))
		.digest("hex")
		.slice(0, 16);
	return `finding-${hash}`;
}

function resolveInsideCwd(cwd: string, file: string): { ok: true; path: string } | { ok: false; message: string } {
	let normalizedFile: string;
	try {
		normalizedFile = normalizeRelativeFile(file);
	} catch {
		return { ok: false, message: "Source path is outside the workspace." };
	}

	const workspace = realpathSync(cwd);
	const target = resolve(workspace, normalizedFile);
	const lexicalRelative = relative(workspace, target);
	if (lexicalRelative === ".." || lexicalRelative.startsWith(`..${"/"}`) || isAbsolute(lexicalRelative)) {
		return { ok: false, message: "Source path is outside the workspace." };
	}

	if (!existsSync(target)) {
		return { ok: true, path: target };
	}

	const realTarget = realpathSync(target);
	const realRelative = relative(workspace, realTarget);
	if (realRelative === ".." || realRelative.startsWith(`..${"/"}`) || isAbsolute(realRelative)) {
		return { ok: false, message: "Source path is outside the workspace." };
	}

	return { ok: true, path: realTarget };
}

export function extractFindingsBlock(output: string): ParsedFindings {
	const match = output.match(/^```review-findings[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/m);
	if (!match) {
		throw new Error("Missing ```review-findings fenced block.");
	}

	const parsed: unknown = JSON.parse(match[1]!);
	if (!isObject(parsed)) {
		throw new Error("review-findings JSON must be an object.");
	}
	if (typeof parsed.summary !== "string") {
		throw new Error("review-findings summary must be a string.");
	}
	if (!Array.isArray(parsed.findings)) {
		throw new Error("review-findings findings must be an array.");
	}

	return {
		summary: parsed.summary,
		findings: parsed.findings.map((finding, index) => validateRawFindingSchema(finding, index)),
	};
}

export function normalizeFindings(rawFindings: RawFinding[]): ReviewFinding[] {
	return rawFindings.map((value, index) => {
		const rawFinding = validateRawFindingSchema(value, index);
		const file = normalizeRelativeFile(rawFinding.file);
		const startLine = requireLine(rawFinding.startLine, "startLine");
		const endLine = optionalPositiveInteger(rawFinding.endLine, "endLine");
		if (endLine !== undefined && endLine < startLine) {
			throw new Error("Finding endLine must be >= startLine.");
		}

		const startColumn = optionalPositiveInteger(rawFinding.startColumn, "startColumn");
		const endColumn = optionalPositiveInteger(rawFinding.endColumn, "endColumn");
		const title = requireNonEmptyString(rawFinding.title, "title");
		const explanation = requireNonEmptyString(rawFinding.explanation, "explanation");
		const suggestedFix = requireNonEmptyString(rawFinding.suggestedFix, "suggestedFix");
		const id = stableFindingId({
			file,
			startLine,
			startColumn,
			endLine,
			endColumn,
			title,
			explanation,
		});

		return {
			id,
			severity: normalizeSeverity(rawFinding.severity),
			file,
			startLine,
			startColumn,
			endLine,
			endColumn,
			title,
			explanation,
			suggestedFix,
			status: "open",
		};
	});
}

export function loadSourceExcerpt(
	cwd: string,
	location: Pick<ReviewFinding, "file" | "startLine" | "endLine">,
	contextLines = 2,
): SourceExcerpt {
	const resolved = resolveInsideCwd(cwd, location.file);
	if (!resolved.ok) {
		return { available: false, message: resolved.message, lines: [] };
	}

	try {
		if (!existsSync(resolved.path)) {
			return { available: false, message: "Source file is unavailable: file not found.", lines: [] };
		}
		if (!statSync(resolved.path).isFile()) {
			return { available: false, message: "Source file is unavailable: not a regular file.", lines: [] };
		}

		const startLine = requireLine(location.startLine, "startLine");
		const endLine = location.endLine === undefined ? startLine : requireLine(location.endLine, "endLine");
		if (endLine < startLine) {
			return { available: false, message: "Source location is unavailable: endLine is before startLine.", lines: [] };
		}

		const sourceLines = readFileSync(resolved.path, "utf-8").split(/\n/).map((line) => line.replace(/\r$/, ""));
		if (sourceLines.at(-1) === "") sourceLines.pop();
		if (startLine > sourceLines.length) {
			return { available: false, message: "Source location is unavailable: startLine is out of range.", lines: [] };
		}

		const context = Math.max(0, Math.floor(contextLines));
		const firstLine = Math.max(1, startLine - context);
		const lastLine = Math.min(sourceLines.length, endLine + context);
		const lines: SourceExcerptLine[] = [];

		for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
			lines.push({
				number: lineNumber,
				text: sourceLines[lineNumber - 1] ?? "",
				selected: lineNumber >= startLine && lineNumber <= endLine,
			});
		}

		return { available: true, lines };
	} catch (error) {
		return {
			available: false,
			message: `Source file is unavailable: ${(error as Error).message}`,
			lines: [],
		};
	}
}
