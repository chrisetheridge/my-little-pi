# AGENTS.md

## Extension layout rule

- Keep `extensions/` runtime-only.
- Pi auto-discovers every `*.ts` file under `extensions/` as a live extension module.
- Do not place test files, fixtures, or scratch files under `extensions/`.
- Put tests at the repo root or in a separate test directory outside `extensions/`.

## Current convention

- Runtime extensions live in `extensions/*.ts` or `extensions/*/index.ts`.
- Tests for those extensions live alongside the repo root as `*.test.ts`.
