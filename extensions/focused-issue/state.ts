import { findProvider, normalizeReference, unsupportedReferenceError } from "./providers.ts";
import type {
	FocusedIssueSnapshot,
	FocusedIssueState,
	IssueProvider,
	IssueProviderError,
	IssueProviderId,
} from "./types.ts";

export interface FocusedIssueControllerOptions {
	providers: IssueProvider[];
	onChange?: (state: FocusedIssueState) => void;
	onPersist?: (snapshot: FocusedIssueSnapshot) => void;
	now?: () => number;
}

const INITIAL_STATE: FocusedIssueState = {
	status: "idle",
	reference: null,
	providerId: null,
	issue: null,
	error: null,
	version: 0,
	lastInjectedVersion: 0,
	pendingInjectedVersion: 0,
	fetchedAt: null,
	token: 0,
};

function cloneSnapshot(state: FocusedIssueState): FocusedIssueSnapshot {
	return {
		status: state.status,
		reference: state.reference,
		providerId: state.providerId,
		issue: state.issue,
		error: state.error,
		version: state.version,
		lastInjectedVersion: state.lastInjectedVersion,
		pendingInjectedVersion: state.pendingInjectedVersion,
		fetchedAt: state.fetchedAt,
	};
}

function isSnapshot(value: unknown): value is FocusedIssueSnapshot {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.status === "string" &&
		("reference" in record) &&
		typeof record.version === "number" &&
		typeof record.lastInjectedVersion === "number"
	);
}

export function restoreFocusedIssueSnapshot(entries: unknown[]): FocusedIssueSnapshot | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as { type?: unknown; customType?: unknown; data?: unknown } | undefined;
		if (entry?.type !== "custom" || entry.customType !== "focused-issue-state") continue;
		if (isSnapshot(entry.data)) return entry.data;
	}
	return undefined;
}

export class FocusedIssueController {
	private state: FocusedIssueState = { ...INITIAL_STATE };
	private abortController: AbortController | null = null;
	private readonly providers: IssueProvider[];
	private readonly onChange?: (state: FocusedIssueState) => void;
	private readonly onPersist?: (snapshot: FocusedIssueSnapshot) => void;
	private readonly now: () => number;

	constructor(options: FocusedIssueControllerOptions) {
		this.providers = options.providers;
		this.onChange = options.onChange;
		this.onPersist = options.onPersist;
		this.now = options.now ?? Date.now;
	}

	getState(): FocusedIssueState {
		return { ...this.state };
	}

	toSnapshot(): FocusedIssueSnapshot {
		return cloneSnapshot(this.state);
	}

	restore(snapshot: FocusedIssueSnapshot | undefined): void {
		if (!snapshot) return;
		this.cancelFetch();
		this.state = {
			...snapshot,
			status: snapshot.status === "loading" || snapshot.status === "stale" ? "stale" : snapshot.status,
			token: this.state.token + 1,
		};
		this.emit(false);
	}

	setFocus(reference: string): FocusedIssueState {
		const normalized = normalizeReference(reference);
		const provider = findProvider(normalized, this.providers);
		if (!normalized || !provider) {
			return this.getState();
		}

		const previousState = this.getState();
		const version = previousState.version + 1;
		const token = previousState.token + 1;

		this.state = {
			status: "loading",
			reference: normalized,
			providerId: provider.id,
			issue: null,
			error: null,
			version,
			lastInjectedVersion: previousState.lastInjectedVersion,
			pendingInjectedVersion: 0,
			fetchedAt: null,
			token,
		};
		this.emit(true);
		this.startFetch(provider, normalized, token, previousState);
		return this.getState();
	}

	refresh(options: { reinject?: boolean } = {}): FocusedIssueState {
		const reference = this.state.reference;
		if (!reference) return this.getState();
		const provider = this.state.providerId ? this.providers.find((candidate) => candidate.id === this.state.providerId) : undefined;
		if (!provider) {
			this.setError(unsupportedReferenceError(reference), this.state.token + 1, true);
			return this.getState();
		}

		const previousState = this.getState();
		this.cancelFetch();
		const token = this.state.token + 1;
		const version = options.reinject ? this.state.version + 1 : this.state.version;
		this.state = {
			...this.state,
			status: this.state.issue ? "stale" : "loading",
			error: null,
			version,
			pendingInjectedVersion: options.reinject ? 0 : this.state.pendingInjectedVersion,
			token,
		};
		this.emit(true);
		this.startFetch(provider, reference, token, previousState);
		return this.getState();
	}

	clear(): FocusedIssueState {
		this.cancelFetch();
		this.state = {
			...INITIAL_STATE,
			version: this.state.version + 1,
			token: this.state.token + 1,
		};
		this.emit(true);
		return this.getState();
	}

	cancel(): void {
		this.cancelFetch();
	}

	markReadyInjected(): void {
		if (this.state.status !== "ready") return;
		this.state = {
			...this.state,
			lastInjectedVersion: this.state.version,
		};
		this.emit(true);
	}

	markPendingInjected(): void {
		if (this.state.status !== "loading" && this.state.status !== "stale") return;
		this.state = {
			...this.state,
			pendingInjectedVersion: this.state.version,
		};
		this.emit(true);
	}

	private startFetch(provider: IssueProvider, reference: string, token: number, previousState: FocusedIssueState): void {
		const abortController = new AbortController();
		this.abortController = abortController;
		void provider.fetchIssue(reference, abortController.signal).then((result) => {
			if (this.state.token !== token || abortController.signal.aborted) return;
			this.abortController = null;
			if (result.ok) {
				this.state = {
					...this.state,
					status: "ready",
					providerId: result.issue.providerId,
					issue: result.issue,
					error: null,
					fetchedAt: this.now(),
				};
				this.emit(true);
				return;
			}
			if (result.error.code === "cancelled") return;
			if (result.error.code === "not_found") {
				this.state = { ...previousState };
				this.emit(false);
				return;
			}
			this.setError(result.error, token, true);
		});
	}

	private setError(error: IssueProviderError, token: number, persist: boolean): void {
		this.state = {
			...this.state,
			status: "error",
			error,
			token,
		};
		this.emit(persist);
	}

	private cancelFetch(): void {
		if (!this.abortController) return;
		this.abortController.abort();
		this.abortController = null;
	}

	private emit(persist: boolean): void {
		const state = this.getState();
		this.onChange?.(state);
		if (persist) this.onPersist?.(cloneSnapshot(state));
	}
}
