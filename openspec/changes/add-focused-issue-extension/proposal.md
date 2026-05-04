## Why

Pi can receive work as a Linear URL or issue key, but today the user must paste task details into the agent conversation manually. A focused issue extension would let the user set the active task once, keep the relevant task metadata visible in the terminal, and inject task context into the first agent turn without blocking AI worker threads on remote API fetches.

## What Changes

- Add a new project extension that lets users set, clear, refresh, and inspect a focused external issue from a command.
- Resolve Linear issue URLs and issue identifiers such as `ENG-123` through a provider abstraction, with room for future GitHub issue and other task provider implementations.
- Fetch issue metadata asynchronously in the extension layer so agent startup and worker execution are not held up by network calls.
- Render a sticky terminal panel near the bottom of the TUI when a focused issue is active, showing title, description summary, assignee, status, URL, associated pull requests, and useful timestamps or labels when available.
- Inject focused issue context into the first relevant agent interaction after focus is set so the user can say "Implement the task" without re-pasting the issue details.
- Keep runtime extension files under `extensions/` and place tests outside `extensions/`.

## Capabilities

### New Capabilities
- `focused-issue`: User-facing commands, sticky UI behavior, focused issue state, and prompt context injection.
- `issue-provider`: Provider contract and Linear provider behavior for resolving task references, fetching metadata asynchronously, and normalizing issue data.

### Modified Capabilities

None.

## Impact

- Adds a new runtime extension under `extensions/`, likely as `extensions/focused-issue/index.ts` plus helper modules.
- Adds the extension to the `pi.extensions` list in `package.json`.
- Adds root-level or `tests/` coverage for command parsing, provider normalization, async refresh state, prompt injection, and sticky UI formatting.
- May introduce optional runtime integration with Linear through the most appropriate available surface, such as Linear GraphQL, MCP, or CLI, while preserving a provider interface for future GitHub issues.
