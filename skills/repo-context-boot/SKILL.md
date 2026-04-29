---
name: repo-context-boot
description: Quickly orient in a repository by reading the key docs and config, then summarize the project map. Use when entering a new repo or returning after a break.
---

# Repo Context Boot

Use this skill when you need to get oriented in a repository fast.

## Workflow

1. Read the project README and any adjacent docs that explain setup or usage.
2. Inspect the package/build config and any obvious plan or task files.
3. Identify the main entry points, source roots, and test locations.
4. Summarize the repo in a compact, practical format:
   - what it does
   - how it is structured
   - how to build/test/run it
   - any notable conventions or hazards
5. If the repo is large, point to the smallest set of files that matter first.

## Output format

Prefer a short answer with sections like:
- Overview
- Key files
- Commands
- Notes / gotchas

## Guardrails

- Do not over-explain.
- Prefer concrete file paths over vague descriptions.
- If something is unclear, state the uncertainty and the next file you would inspect.