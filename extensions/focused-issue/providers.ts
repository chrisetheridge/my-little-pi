import type { IssueProvider, IssueProviderError } from "./types.ts";

export function normalizeReference(reference: string): string {
	return reference.trim();
}

export function findProvider(reference: string, providers: IssueProvider[]): IssueProvider | undefined {
	const normalized = normalizeReference(reference);
	if (!normalized) return undefined;
	return providers.find((provider) => provider.canHandle(normalized));
}

export function unsupportedReferenceError(reference: string): IssueProviderError {
	return {
		code: "unsupported",
		message: `No issue provider supports "${reference}".`,
		retryable: false,
	};
}

export function errorFromUnknown(error: unknown): IssueProviderError {
	if (error instanceof DOMException && error.name === "AbortError") {
		return {
			code: "cancelled",
			message: "Issue fetch was cancelled.",
			retryable: true,
		};
	}
	if (error instanceof Error) {
		return {
			code: "unknown",
			message: error.message,
			retryable: true,
		};
	}
	return {
		code: "unknown",
		message: "Unknown issue provider error.",
		retryable: true,
	};
}
