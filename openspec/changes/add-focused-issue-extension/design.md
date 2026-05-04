## Context

This package contains Pi runtime extensions loaded directly from TypeScript. Runtime files under `extensions/` are auto-discovered and must not contain tests, fixtures, or scratch files. Existing extensions use `pi.registerCommand()`, lifecycle events, and TUI components from `@mariozechner/pi-coding-agent` and `@mariozechner/pi-tui`.

The new extension needs to bridge external issue trackers and the agent loop. Users may provide a Linear URL or an issue key such as `ENG-123`; the extension should resolve it, keep metadata visible near the editor, and inject enough context into the next agent turn that a short request such as "Implement the task" is actionable.

## Goals / Non-Goals

**Goals:**

- Provide a focused issue command flow that works from a URL or provider-specific identifier.
- Keep issue fetching asynchronous and cancelable so remote calls do not block agent turns or worker threads.
- Normalize issue metadata through a provider interface that can support Linear first and GitHub issues later.
- Render focused issue state as a compact above-editor widget with loading, success, stale, and error states.
- Inject focused issue context once after the focus changes, then avoid repeating large context on every turn.
- Persist or reconstruct enough focus state across reloads and session changes to keep the UI useful.

**Non-Goals:**

- Implement GitHub issue support in the first version.
- Modify issue state in Linear, such as changing assignee or status.
- Require a new mandatory package dependency if an existing local CLI, MCP, or GraphQL access path can provide the data.
- Build a long-form issue browser; the sticky UI is a focused task summary, not a full tracker client.

## Decisions

1. Use `extensions/focused-issue/` with `index.ts` plus helper modules.

   The feature has parsing, provider resolution, state management, UI rendering, and prompt formatting concerns. A directory extension keeps the entry point small while staying inside the runtime-only `extensions/` tree. Tests will live under `tests/` and mirror helper modules.

2. Register `/focus-issue <ref>` as the primary command and `/set-focused-issue <ref>` as a discoverable alias.

   `/focus-issue` is shorter and reads as an action. The explicit alias matches the requested command shape and reduces migration friction. The command handler will also support subcommands such as `clear`, `refresh`, and `show` through its argument string.

3. Model external trackers as `IssueProvider` implementations.

   The extension will define a provider contract that can detect references, resolve a canonical issue ID, fetch metadata, and return a normalized `FocusedIssue` object. Linear will be the first provider. Provider-specific payloads can be stored in an optional `raw` field for future UI or prompt improvements without leaking provider details into the rest of the extension.

4. Perform remote fetches outside the agent turn path.

   Setting focus updates local state immediately to `loading` and starts an asynchronous refresh using an `AbortController`. `before_agent_start` must only inject already available metadata or a compact pending note; it must not wait for Linear. `session_shutdown` cancels in-flight refreshes.

5. Render with `ctx.ui.setWidget("focused-issue", ..., { placement: "aboveEditor" })`.

   An above-editor widget keeps the issue visible near the input without crowding Pi's footer/status line. The widget will render markdown inside a bordered TUI panel with truncation and wrapping for terminal widths, including state markers for loading, stale data, and errors.

6. Inject context through `before_agent_start` once per focus version.

   The extension will track a monotonically increasing focus version and the last injected version. When metadata is ready and has not been injected for the active focus, the hook returns a custom message containing title, URL, status, assignee, description, PRs, and relevant labels/dates. Refreshes that update metadata should mark the focus version dirty only when the active task changes or the user explicitly asks to reinject.

7. Keep durable state minimal.

   The durable state should include the active reference, provider ID, canonical issue ID when known, fetched metadata snapshot, fetch timestamp, error state, and injection marker. The implementation can reconstruct from session history where possible and may use extension-local config if Pi exposes a suitable agent directory helper. Sensitive credentials must not be persisted.

## Risks / Trade-offs

- Linear credentials may be unavailable or configured differently per environment -> show a clear error in the widget and keep the focused reference so the user can retry after configuring access.
- Linear API shape or CLI output may vary -> isolate all provider parsing inside the Linear provider and test normalization with representative fixtures outside `extensions/`.
- Above-editor widget space is limited -> render a compact summary by default and use `/focus-issue show` for the full normalized metadata.
- Prompt injection could consume too much context -> summarize descriptions, cap associated PRs and labels, and inject only once per focused issue version.
- Async fetch races can display stale data -> tag each request with the active focus token and ignore results for superseded tokens.
- Session reloads may lose purely in-memory focus state -> define replayable state and restore from session entries or extension-local state before treating this as complete.

## Migration Plan

1. Add the new extension directory and register it in `package.json`.
2. Implement provider-independent parsing, state transitions, prompt formatting, and widget rendering with unit tests.
3. Add the Linear provider behind the provider interface.
4. Add command integration and lifecycle hooks.
5. Run `npm test` and `npm run check`, then manually verify in Pi with `/reload`, `/focus-issue <Linear ref>`, and an agent turn that relies on injected context.
6. Roll back by removing the package extension entry and the `extensions/focused-issue/` runtime directory if the feature causes interactive issues.

## Open Questions

- Which Linear access path should the first implementation prefer in this repo: GraphQL with a configured API key, MCP, or the Linear CLI?
- Should focused issue state be scoped per session, per repository, or globally across Pi sessions?
- Should an explicit command such as `/focus-issue inject` force reinjection after the initial automatic injection?
