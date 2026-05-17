# CONTEXT-MAP.md

Use this file to route repo reading before editing.

## Package manifest

- `package.json` declares exported Pi resources under the `pi` field.
- Keep manifest entries in sync with actual directories and files.
- Use `pnpm` for dependency and lockfile changes.

## Extensions

- Runtime code lives under `extensions/`.
- Tests live under `tests/`, not under `extensions/`.
- Read `AGENTS.md` before editing extensions because Pi auto-discovers runtime files.
- Extension-specific docs:
  - `extensions/downtime/README.md`
  - `extensions/review/README.md`

## Skills

- Local skills live under `skills/<skill-name>/SKILL.md`.
- Keep large examples or phrase lists in `references/` files beside the skill.

## Themes

- Pi TUI themes live under `themes/*.json`.

## Specs

- Design notes and planned changes live under `docs/superpowers/specs/`.

## Workflow

- GitHub Issues is the repo issue tracker.
- Linear support in this repo is packaged functionality, not the repo workflow.
