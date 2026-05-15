# Landing Workflow Extension Design

## Goal

Build a Pi extension that opens a full-screen `/land` TUI for landing repository changes through a configurable, real-command workflow.

The v1 workflow is repo-configured through JSON and supports two step types:

- `shell`: run a configured shell command.
- `commit`: automatically stage all changes, generate an agent commit message with an explicit model, and commit.

## Scope

### In scope

- Register `/land` only.
- Load config from existing Pi extension conventions:
  - global: `~/.pi/agent/extensions/landing-workflow.json`
  - project override: `.pi/extensions/landing-workflow.json`
- Require a config file. If no config exists, `/land` opens with Start disabled and clear setup instructions.
- Run steps sequentially with real commands.
- Show a full-screen two-column TUI with workflow state and live output.
- Stop immediately on failure.
- Cancel the active command with SIGTERM.
- Keep all workflow state ephemeral.

### Out of scope for v1

- `/land init` or other helper commands.
- Sharing Pi session links.
- User editing commit messages.
- Fully interactive shell subprocesses.
- Generic prompt variables or pre-step hooks.
- Persisting run history with `pi.appendEntry`.

## Config model

Example `.pi/extensions/landing-workflow.json`:

```json
{
  "steps": [
    {
      "type": "shell",
      "label": "Fetch/Rebase",
      "command": "git fetch origin && git rebase origin/main"
    },
    {
      "type": "shell",
      "label": "Tests",
      "command": "pnpm test"
    },
    {
      "type": "commit",
      "label": "Commit",
      "model": "sonnet"
    },
    {
      "type": "shell",
      "label": "Push",
      "command": "git push"
    }
  ]
}
```

Validation rules:

- `steps` must be a non-empty array.
- Each step must have a non-empty `label`.
- `shell` steps must have a non-empty `command`.
- `commit` steps must have a non-empty `model`.
- Unknown step types fail config validation.
- Project config overrides global config when present.

## Runtime behavior

`/land` opens the panel in an idle state. It does not start automatically.

Footer controls:

- idle: `Enter Start · Esc Cancel`
- running: `Esc Cancel`
- failed, canceled, success: `Esc Close`

Step execution:

- Steps run sequentially.
- A failed step stops the workflow immediately.
- Shell steps run in `ctx.cwd` through the user's default shell: `$SHELL -lc <command>`, falling back to `/bin/sh` when `$SHELL` is unset.
- stdout and stderr are merged into one output stream in arrival order.
- The TUI updates status, output, elapsed time, progress, and per-step duration while commands run.

Cancel behavior:

- If a process is active, send SIGTERM.
- Mark the active step as canceled.
- Stop the workflow and keep the panel open.

## Commit step behavior

A `commit` step manages the full commit operation:

1. Run `git add -A`.
2. Run `git diff --cached --quiet`.
   - exit `0`: fail the step with `No changes staged after git add -A`.
   - exit `1`: continue; staged changes exist.
   - any other exit code: fail with the git error.
3. Collect commit context:
   - `git status --short`
   - `git diff --cached --stat`
   - capped `git diff --cached` for internal safety on very large diffs
4. Spawn a one-shot Pi print-mode subprocess using the configured model:
   - `pi -p --no-session --model <model> <commit-message-prompt>`
5. Validate that the generated message is non-empty.
6. Write the message to a temporary file.
7. Run `git commit -F <temp-file>`.

The commit message is not editable in v1. The commit step output pane should show each sub-action and command output so failures are diagnosable.

## TUI layout

The custom component uses full-screen `ctx.ui.custom(...)` rendering with two columns.

Left column: workflow panel

- Header: `Landing Workflow`
- Config source or config error
- Overall status: idle, running, failed, canceled, success
- Total elapsed time
- Progress bar based on completed steps / total steps
- Current step label
- Step list with:
  - status icon/text
  - label
  - per-step duration
  - command preview for `shell`
  - `agent commit (<model>)` for `commit`
- Footer controls

Right column: output panel

- Header: `Output`
- Active command/action
- Merged live output stream
- Auto-scroll to bottom
- Preserved output after success, failure, or cancellation

Rendering constraints:

- Every rendered line must fit within the provided width.
- Use ANSI-aware width helpers from `@mariozechner/pi-tui` where needed.
- The component requests re-render after state, output, or timer changes.
- Timers and subprocesses are disposed when the panel closes.

## Architecture

Files:

- `extensions/landing-workflow/index.ts`
  - Pi extension entrypoint.
  - Registers `/land`.
  - Loads config and opens the TUI.
- `extensions/landing-workflow/types.ts`
  - Shared config, runtime state, step, and result types.
- `extensions/landing-workflow/config.ts`
  - Config path resolution.
  - JSON loading.
  - Validation and normalized config output.
- `extensions/landing-workflow/runner.ts`
  - Sequential step runner.
  - Shell process spawning.
  - SIGTERM cancellation.
  - Commit-step implementation.
  - Output/event callbacks for the UI.
- `extensions/landing-workflow/ui.ts`
  - Full-screen component.
  - Keyboard handling.
  - Layout, progress, duration, and output rendering.
- `tests/extensions/landing-workflow/config.test.ts`
- `tests/extensions/landing-workflow/runner.test.ts`
- `tests/extensions/landing-workflow/ui.test.ts`

Package/docs updates:

- Add `./extensions/landing-workflow/index.ts` to `package.json > pi.extensions`.
- Document `/land`, config path, example config, controls, and step types in `README.md`.

## Testing plan

Use Vitest unit tests around focused modules.

Config tests:

- Missing global/project config returns a disabled/error state with expected project path.
- Project config wins over global config.
- Invalid JSON reports a readable error.
- Missing `steps`, empty `steps`, bad step type, missing shell `command`, and missing commit `model` are rejected.
- Valid hybrid config is normalized.

Runner tests:

- Shell steps use `$SHELL -lc` in the configured cwd.
- stdout and stderr are emitted into one output stream.
- Non-zero shell exit marks the step failed and stops later steps.
- Cancel sends SIGTERM to the active child process.
- Commit step fails when `git diff --cached --quiet` exits `0` after `git add -A`.
- Commit step runs `git add -A`, gathers git context, calls `pi -p --no-session --model <model>`, writes a temp message file, and runs `git commit -F <file>`.
- Empty agent commit output fails the step.

UI tests:

- Idle state renders title, config source/error, Start control, progress, and step list.
- Running state renders active step, elapsed time, progress, and output.
- Failed state renders failed status and keeps output visible.
- Success state renders all steps complete and final controls.
- Escape in running state calls cancel; Enter in idle state starts.

Full verification before completion:

```bash
pnpm run check
pnpm run test
pnpm run pack:dry-run
```
