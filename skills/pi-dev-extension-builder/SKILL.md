---
name: pi-dev-extension-builder
description: Build and modify pi.dev extensions for the Pi coding agent. Use when creating TypeScript extension modules, custom tools, commands, lifecycle hooks, or reloadable project/global extensions.
---

# Pi Dev Extension Builder

Use this skill when you need to build or change a pi.dev extension.

## Workflow

1. Pick the extension shape.
   - Single file for small extensions.
   - Directory with `index.ts` for multi-file extensions.
   - Package with `package.json` when runtime dependencies are needed.
2. Put the extension where Pi can discover it.
   - Global: `~/.pi/agent/extensions/`
   - Project-local: `.pi/extensions/`
   - Use `pi -e ./path.ts` for quick one-off tests.
3. Export a default factory that receives `ExtensionAPI`.
   - Use `async` only when startup work must finish before the session begins.
4. Wire behavior through events and APIs.
   - `session_start` for setup and state rebuild.
   - `session_shutdown` for cleanup.
   - `before_agent_start` to inject or adjust prompt context.
   - `tool_call` to block or patch tool calls before execution.
   - `pi.registerTool()`, `pi.registerCommand()`, `pi.registerShortcut()`, `pi.registerFlag()`, `pi.registerProvider()` as needed.
5. Keep tool UX tight.
   - Use `ctx.ui.confirm()`, `select()`, `input()`, `editor()`, and `notify()` for simple interaction.
   - Check `ctx.hasUI` before using UI methods in non-interactive modes.
   - Use `ctx.ui.custom()` only when a normal dialog is not enough.
6. Make state durable.
   - Store replayable state in tool result `details`.
   - Reconstruct from `ctx.sessionManager.getBranch()` on `session_start`.
7. Test the same way Pi will run it.
   - Use `/reload` for auto-discovered extensions.
   - Verify the exact prompt/tool flow, not just TypeScript compilation.

## Guardrails

- Prefer explicit blocking reasons when a tool call is denied.
- Resolve file paths before mutating files.
- If a custom tool writes files, use `withFileMutationQueue()` so it participates in Pi's per-file write queue.
- Use `promptSnippet` and `promptGuidelines` only when the tool should appear in the model prompt.
- Keep extension logic small and composable; move reusable helpers into separate files.

## Reference

See [the extension reference](references/extensions.md) for the API cheat sheet and the behaviors most likely to matter when authoring pi.dev extensions.
