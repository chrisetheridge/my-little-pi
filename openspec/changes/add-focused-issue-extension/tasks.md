## 1. Extension Scaffold

- [x] 1.1 Create `extensions/focused-issue/` with an `index.ts` entry point and helper modules for types, state, providers, prompt formatting, and UI rendering.
- [x] 1.2 Register the new extension path in `package.json` under `pi.extensions`.
- [x] 1.3 Add test files under `tests/` or root-level test locations outside `extensions/`.

## 2. Provider Model

- [x] 2.1 Define normalized issue metadata types, pull request metadata types, provider errors, and the `IssueProvider` interface.
- [x] 2.2 Implement provider selection for issue references and unsupported-reference handling.
- [x] 2.3 Implement Linear reference parsing for Linear URLs and arbitrary uppercase team-key issue identifiers such as `ENG-123` and `PLAT-987`.
- [x] 2.4 Implement the Linear fetch adapter with cancellation support and normalized metadata output.
- [x] 2.5 Add provider tests for reference detection, unsupported input, Linear URL/key parsing, normalized metadata, pull request metadata, and fetch errors.

## 3. Focus State

- [x] 3.1 Implement focused issue state transitions for idle, loading, ready, stale, error, and cleared states.
- [x] 3.2 Start asynchronous refreshes when focus changes without awaiting remote provider work in the command path.
- [x] 3.3 Cancel in-flight refreshes on focus changes and session shutdown.
- [x] 3.4 Ignore superseded fetch results by tagging requests with the active focus token.
- [x] 3.5 Restore replayable focused issue state on session start or extension reload when available.
- [x] 3.6 Add state tests for focus changes, refresh, cancellation, stale result suppression, errors, and reload restoration.

## 4. Commands

- [x] 4.1 Register `/focus-issue` with argument handling for `<ref>`, `clear`, `refresh`, and `show`.
- [x] 4.2 Register `/set-focused-issue` as an alias for setting focus from a reference.
- [x] 4.3 Show concise UI notifications for success, unsupported references, missing focus, refresh start, and provider failures.
- [x] 4.4 Add command tests covering the primary command, alias command, clear, refresh, show, and non-interactive behavior.

## 5. Sticky UI

- [x] 5.1 Implement an above-editor widget using `ctx.ui.setWidget("focused-issue", ..., { placement: "aboveEditor" })`.
- [x] 5.2 Render compact loading, ready, stale, and error summaries with terminal-width-aware wrapping and truncation.
- [x] 5.3 Include title, status, assignee, URL, description summary, associated pull requests, labels, and useful timestamps when available.
- [x] 5.4 Remove the widget when focus is cleared or interactive UI is unavailable.
- [x] 5.5 Add UI formatting tests for loading, ready, error, narrow terminal width, missing optional fields, and multiple pull requests.

## 6. Prompt Injection

- [x] 6.1 Implement compact focused issue context formatting for agent prompt injection.
- [x] 6.2 Hook `before_agent_start` so ready metadata is injected once per focus version without waiting on pending fetches.
- [x] 6.3 Inject only a compact pending note when an agent turn starts before metadata is ready.
- [x] 6.4 Mark new focused issues and explicit reinjection requests as eligible for prompt context injection.
- [x] 6.5 Add prompt injection tests for ready metadata, pending metadata, repeated turns, focus changes, and explicit reinjection.

## 7. Verification

- [x] 7.1 Run `npm test`.
- [x] 7.2 Run `npm run check`.
- [ ] 7.3 Manually verify in Pi with `/reload`, `/focus-issue <Linear ref>`, `/focus-issue show`, `/focus-issue refresh`, `/focus-issue clear`, and one agent turn that relies on focused issue context.
