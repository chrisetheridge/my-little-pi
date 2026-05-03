# Review Extension Design

## Goal

Build a Pi extension that turns code review output into a blocking, structured review flow. The user starts `/review`, chooses a review target, the currently selected Pi model performs review in a fresh review branch, and actionable findings are shown one at a time in a navigator instead of as a wall of Markdown.

The extension should preserve Pi's normal review capabilities by using a normal agent turn with the selected model and normal tool stack. It should add structure around that turn: target selection, preflight confirmation, strict finding extraction, finding navigation, ignored-state persistence, and scoped Q&A.

## Runtime Shape

The runtime extension will live under `extensions/review/index.ts`, with helper modules under `extensions/review/` as needed. Tests must live outside `extensions/`, at the repo root or another non-runtime test directory, because Pi auto-discovers every `*.ts` file under `extensions/` as a live extension module.

The extension registers a `/review` command. `/review` requires interactive UI mode and a selected model. It always starts a new review run and does not resume old runs in v1.

## Review Modes

The command presents four review modes:

- Specific commit: prompt for a commit ref and review `git show <ref>`.
- Pull request URL: prompt for a PR URL, require a clean worktree, record the current git branch/ref, use `gh pr checkout <url>`, review the checked-out PR, then restore the original branch/ref.
- Local changes against base: autodetect the base branch, compute the merge base, and review all changes from that base to the current working tree, including committed, staged, and unstaged changes.
- Uncommitted changes: review staged and unstaged changes only.

Base autodetection should try, in order:

1. The current branch upstream.
2. The remote default branch, such as `origin/HEAD`.
3. Local default branches such as `main`, then `master`.
4. If detection fails, prompt the user for a base branch.

Before running the agent, the extension shows a preflight summary with the selected mode, resolved target, changed files, staged/unstaged counts where relevant, and any checkout/restore behavior. The user can confirm or cancel.

## Agent Review Flow

After preflight confirmation, the extension records the current Pi session leaf, creates or navigates to a fresh review branch, and sends a normal Pi user message with the review prompt. The review branch remains in Pi history for auditability.

The prompt instructs the reviewer to:

- perform code review only;
- not modify files;
- focus on actionable correctness, regression, security, maintainability, or test coverage findings;
- avoid "looks good" notes;
- inspect files, search the repo, and run commands only as needed to validate concrete review concerns;
- return a final machine-readable findings block.

The extension waits for the agent to become idle, extracts the final assistant output, parses the findings block, restores the original git ref if PR mode was used, then opens the blocking findings navigator.

For PR mode, restore must run after the review agent finishes or errors. If restore fails, the extension shows a blocking error with the original ref and current ref. The extension does not stash, discard, or silently clean changes.

## Finding Schema

The reviewer must return only actionable findings. If there are no findings, it returns an empty findings array and a short summary.

Each finding contains:

- `id`: model-provided ID, later normalized by the extension;
- `severity`: severity label;
- `file`: path relative to the repo root;
- `startLine`: 1-based start line;
- `startColumn`: optional 1-based start column;
- `endLine`: optional 1-based end line;
- `endColumn`: optional 1-based end column;
- `title`: concise issue title;
- `explanation`: why this is a problem;
- `suggestedFix`: concrete remediation guidance.

The extension should normalize or replace model-provided IDs with stable IDs derived from location, title, and explanation hash. UI source excerpts are derived from `file` and line/column data by reading the workspace file, not trusted from model output.

If the findings JSON is missing or invalid, the extension shows a blocking recovery state with the raw assistant output and options to retry extraction or cancel. Retry extraction must produce the same schema before the navigator opens.

## Findings UI

The findings UI is a blocking custom TUI near the bottom of the screen. It owns focus until closed.

For one finding at a time, it shows:

- current position, such as `3 / 8`;
- severity;
- file path and line/column;
- title;
- explanation;
- suggested fix;
- derived source excerpt around the finding location;
- status, initially `open` or later `ignored`.

Controls:

- next;
- previous;
- ignore;
- actions entry point, disabled in v1 until action behavior is designed;
- ask questions;
- exit review.

Ignored findings remain navigable and are visually marked ignored. They are not hidden in v1.

If no actionable findings are returned, the same blocking UI shows an empty state with the review target summary and "No actionable findings found."

Exit is always available. If any findings remain `open`, the UI asks for confirmation before closing. If no findings remain open, exit closes immediately.

## Q&A Sub-Dialogue

From a selected finding, `ask questions` opens a nested blocking dialogue scoped to that finding. Q&A can clarify, justify, or discuss the selected finding and possible fixes. It must not silently create new findings or perform a new review.

The Q&A context includes:

- selected finding data;
- review target metadata;
- source excerpt derived from file and line/column;
- prior Q&A for that finding;
- an instruction to answer only about the selected finding.

Q&A uses the currently selected Pi model. For v1, it should use a direct model call with the selected finding context rather than a normal tool-using Pi turn, because the Q&A is explanatory and should not mutate the review transcript.

The Q&A dialogue keeps the same high-level controls available: ignore, actions entry point disabled in v1, next, previous, and back to finding. If the user navigates next or previous inside Q&A, the active finding changes and the dialogue updates to that finding's Q&A thread.

Q&A history is persisted under the finding's stable ID.

## Persistence

Each `/review` run creates durable review state as custom Pi session data:

- review run ID;
- created timestamp;
- mode and resolved target metadata;
- original session leaf;
- review branch/session reference where available;
- raw assistant review output or a reference to it;
- normalized findings;
- per-finding status, initially `open` or `ignored`;
- per-finding Q&A history;
- current finding index.

Old review runs are historical. `/review` starts a new run and supersedes any previous active review UI state. A future `/review resume` command can be added separately.

## Error Handling

The extension handles:

- no UI: notify that `/review` requires interactive mode;
- no selected model: notify before preflight;
- not a git repo: show a blocking error;
- base branch autodetect failure: prompt for base branch;
- PR mode dirty worktree: stop before checkout;
- missing `gh` or failed `gh pr checkout`: show an error and do not continue;
- review agent abort/failure: show an error and restore the original git ref if needed;
- invalid findings JSON: show recovery UI with raw output and retry/cancel;
- source excerpt file missing or line out of range: show the location and a clear source unavailable message.

## Implementation Slices

The full design is larger than a safe first patch. Implementation should be sliced:

1. Uncommitted and local-vs-base modes, structured parsing, and a basic blocking navigator.
2. Persistence for ignored findings and current index.
3. Q&A sub-dialogue.
4. Specific commit mode.
5. Pull request URL checkout/restore mode.
6. JSON recovery polish and disabled actions entry point wiring.

## Test Plan

Tests should cover:

- `/review` command registration;
- target resolution for all four modes;
- base autodetection fallback order;
- PR dirty-worktree guard and restore behavior;
- structured findings parsing;
- stable ID normalization;
- persisted ignore and Q&A state updates;
- no-findings empty state;
- invalid JSON recovery path;
- source excerpt derivation from file, line, and column.
