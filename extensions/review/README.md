# Review

Interactive code review extension for Pi.

## What it does

- Registers the `/review` command.
- Supports review targets for uncommitted changes, a base ref, a commit ref, or a pull request URL.
- Runs the review in a fresh session and extracts structured findings from the assistant output.
- Shows findings in the UI so you can accept or edit them before generating fix prompts.
- Optionally recovers malformed findings output with a formatter model.
- Restores the original git ref after review work completes.

## Usage

Run `/review` in an interactive session with a model selected.

You will be prompted to choose a target:

- `uncommitted` — review local working tree changes
- `base` — review against a base branch/ref
- `commit` — review a commit range/ref
- `pr` — review from a pull request URL

## Requirements

- Interactive Pi session
- Selected model
- Git repository

## Files

- `index.ts` — command registration and review flow
- `git.ts` — review target detection and git ref handling
- `prompt.ts` — prompt builders
- `findings.ts` — findings parsing and normalization
- `ui.ts` — review UI and recovery dialogs
- `state.ts` — review state initialization
