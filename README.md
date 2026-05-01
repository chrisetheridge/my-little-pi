# my-little-pi

Personal package for [Pi](https://pi.dev) extensions, skills, prompt templates, and themes.

Pi packages are regular npm or git packages that expose resources through the `pi` field in `package.json`.
For git installs, Pi clones the repository, runs `npm install` when `package.json` is present, then loads the declared resources. Pi core packages imported by extensions are listed as peer dependencies.

## Contents

- `extensions/` - TypeScript or JavaScript Pi extensions.
- `skills/` - Agent Skills packages, each with a `SKILL.md`.
- `prompts/` - Markdown prompt templates available as slash commands.
- `themes/` - JSON themes for Pi's terminal UI.

## Install Pi

```bash
npm install -g @mariozechner/pi-coding-agent
```

Start Pi with:

```bash
pi
```

## Install This Package

From this local checkout:

```bash
pi install ./ -l
```

Project-local installs are written to `.pi/settings.json` for the current project. Omit `-l` to install globally in `~/.pi/agent/settings.json`.

From git:

```bash
pi install git:github.com/chrisetheridge/my-little-pi
```

From npm if published later:

```bash
pi install npm:my-little-pi
```

## Try Without Installing

```bash
pi -e ./
```

## Use

- Run `/little-pi` in Pi to verify the example extension loaded.
- File hooks now live in the sibling [pi-file-hooks](../pi-file-hooks) project.
- Run `/review-staged` to expand the staged-code-review prompt template.
- Run `/debug-issue <description>` to expand the debugging prompt template.
- Run `/skill:pi-package-maintainer` when changing this package.
- Run `/answer` to turn the last assistant message into an interactive Q&A flow.
- Select the `my-little-pi` theme in `/settings`, or set it manually:

```json
{
  "theme": "my-little-pi"
}
```

## Develop

Install dependencies for editor types and local checks:

```bash
npm install
```

Run checks:

```bash
npm run check
npm run pack:dry-run
```

Reload Pi resources after edits:

```text
/reload
```

Themes hot-reload when the active theme file changes.

## Package Manifest

`package.json` exposes all resources through:

```json
{
  "pi": {
    "extensions": [
      "./extensions/downtime/index.ts",
      "./extensions/little-footer/index.ts",
      "./extensions/little-renderer/index.ts",
      "./extensions/little-spinner/index.ts"
    ],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

## References

- [Pi packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md)
- [Pi extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)
- [Pi skills](https://contextqmd.com/libraries/pi-mono/versions/0.61.0/pages/packages/coding-agent/docs/skills)
- [Pi prompt templates](https://mintlify.wiki/badlogic/pi-mono/coding-agent/prompt-templates)
- [Pi themes](https://mintlify.wiki/badlogic/pi-mono/coding-agent/themes)
