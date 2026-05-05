# Focused Issue

Focused external issue extension for Pi.

## What it does

- Registers `/focus-issue` command.
- Fetches issue metadata from supported issue providers.
- Keeps the focused issue visible in the UI above the editor.
- Injects focused issue context into the next assistant turn.
- Persists focused issue state in the session branch so it survives reloads and resumes.
- Detects supported issue references in user messages and automatically focuses them when enabled.

## Usage

Focus an issue manually:

```text
/focus-issue ENG-123
```

Manage the current focus:

```text
/focus-issue show
/focus-issue refresh
/focus-issue inject
/focus-issue clear
```

Scroll the sticky focused issue panel:

```text
Ctrl+Shift+Down
Ctrl+Shift+Up
```

## Automatic Focus

When `autoFocusIssueMentions` is enabled, Pi inspects user input before the assistant starts. If the message contains a supported issue reference, the extension focuses that issue and displays the focused issue UI.

For Linear, references like `ENG-123` and Linear issue URLs are supported.

## Config

Example `.pi/extensions/focused-issue.json`:

```json
{
  "autoFocusIssueMentions": true
}
```

The same config can be set globally at `~/.pi/agent/extensions/focused-issue.json`.

## Fields

- `autoFocusIssueMentions`: automatically focus supported issue references mentioned in user messages. Defaults to `true`.

## Requirements

- `LINEAR_API_KEY` must be set to fetch Linear issue metadata.
