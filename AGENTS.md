# AGENTS.md

## Repo purpose

This repo is a personal Pi package. It packages runtime extensions, local agent skills, and themes for Pi.

## Package manager

- Use `pnpm` for dependency changes and lockfile updates.
- Do not create or update `package-lock.json` or `yarn.lock`.

## Pi docs

When changing Pi extension, skill, theme, prompt-template, TUI, or package behavior, read the relevant Pi docs first:

- Main docs: `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/README.md`
- Extra docs: `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/docs`
- Examples: `/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/examples`

Prefer local docs/examples over guessing APIs.

## Extension layout rule

- Keep `extensions/` runtime-only.
- Pi auto-discovers every `*.ts` file under `extensions/` as a live extension module.
- Do not place test files, fixtures, or scratch files under `extensions/`.
- Put tests under `tests/`.

## Current conventions

- Runtime extensions live in `extensions/*.ts` or `extensions/*/index.ts`.
- Extension implementation helpers may live beside the runtime entrypoint under the same extension directory.
- Tests live under `tests/`, mirroring the extension name when practical.
- Skills live under `skills/<skill-name>/SKILL.md` with optional `references/` files.
- Themes live under `themes/*.json`.
- Package exports are declared in `package.json` under the `pi` field. Keep that manifest in sync with actual package directories.

## Verification

Run the narrowest relevant test while developing, then run the full package checks before completion:

```bash
pnpm run check
pnpm run test
pnpm run pack:dry-run
```

Use `pnpm run ci` when you want the standard full verification sequence.

## Issue tracker

GitHub Issues is the authoritative issue tracker for this repo. Linear references in extension or skill code are product functionality, not this repo's workflow source of truth.

## Generated and dependency files

- Do not edit `node_modules/`.
- Do not hand-edit lockfiles except as part of a package-manager operation.
- Do not commit local `.pi/` runtime state unless explicitly requested.
