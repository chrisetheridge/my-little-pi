---
name: pi-package-maintainer
description: Maintain this repository as a Pi package. Use when adding or changing Pi extensions, skills, prompts, themes, or package metadata.
---

# Pi Package Maintainer

Use this workflow when modifying this package.

## Resource Layout

- Put Pi extensions in `extensions/` as `.ts` or `.js` files.
- Put skills in `skills/<skill-name>/SKILL.md`.
- Put prompt templates in `prompts/*.md`.
- Put themes in `themes/*.json`.
- Keep `package.json` `pi` entries aligned with the resource directories.

## Checks

Before finishing package changes:

```bash
npm run check
npm run pack:dry-run
```

## Packaging Rules

- Runtime npm dependencies belong in `dependencies`.
- Pi-bundled imports such as `@mariozechner/pi-coding-agent` and `typebox` should stay as peer dependencies.
- Skills should be focused workflows, not one-off prompt snippets.
- Prompt templates should stay short and reusable.
- Themes must define every required Pi color token.
