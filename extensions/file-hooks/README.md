# File Hooks

Generic post-tool hook runner for file mutations.

## What it does

- Watches `tool_result` events for any tool result that includes `input.path`.
- Matches the path against glob patterns.
- Runs the configured command after the tool completes.
- Uses the Pi UI for status and notifications so hook activity is visible in the session.

## Config

Create `.pi/extensions/file-hooks.json` in the project root, or `~/.pi/agent/extensions/file-hooks.json` globally.

```json
{
  "hooks": [
    {
      "name": "cljfmt",
      "match": ["**/*.clj", "**/*.cljc", "**/*.cljs"],
      "command": "bb",
      "args": ["cljfmt-fix", "{path}"]
    }
  ]
}
```

## Template variables

- `{path}`: project-relative path
- `{relativePath}`: same as `{path}`
- `{absolutePath}`: absolute filesystem path
- `{cwd}`: current project root
- `{dir}`: parent directory of the target
- `{absoluteDir}`: absolute parent directory of the target

## Notes

- `tools` is optional. When omitted, the hook applies to `write` and `edit`.
- `cwd` is optional. When omitted, the command runs in the current project root.
- Named hooks replace earlier hooks with the same `name` when both global and project config are loaded.
