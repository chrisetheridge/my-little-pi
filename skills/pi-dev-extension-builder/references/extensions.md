# Pi Dev Extension Reference

This is the condensed reference for building pi.dev extensions.

## Discovery and loading

- Extensions are TypeScript modules.
- Pi can auto-discover extensions from `~/.pi/agent/extensions/` and `.pi/extensions/`.
- `pi -e ./path.ts` is for quick tests.
- Auto-discovered extensions can hot-reload with `/reload`.
- TypeScript is loaded through `jiti`, so no build step is required for simple `.ts` extensions.

## Recommended shapes

- Single file: best for small, focused behavior.
- Directory with `index.ts`: best for helpers and multiple modules.
- Package: use when the extension needs runtime npm dependencies.

## Core entry point

```ts
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("loaded", "info");
  });
}
```

- The default export is the extension factory.
- The factory can be synchronous or async.
- If the factory is async, Pi waits for it before startup continues.

## Events to use most often

- `session_start`: initialize or rebuild in-memory state.
- `session_shutdown`: release resources before the session or extension instance ends.
- `resources_discover`: add extra skill, prompt, or theme paths.
- `before_agent_start`: inject messages or adjust the system prompt for the next turn.
- `tool_call`: inspect, mutate, or block tool calls before execution.

## Tool building

- Register tools with `pi.registerTool()`.
- Register commands with `pi.registerCommand()`.
- Register shortcuts with `pi.registerShortcut()`.
- Register flags with `pi.registerFlag()`.
- Register providers with `pi.registerProvider()` when the extension needs model/provider setup.
- Use `promptSnippet` for a one-line tool mention in the prompt.
- Use `promptGuidelines` for tool-specific prompt bullets.
- If a tool should only be active sometimes, manage it with `pi.setActiveTools()`.

### Tool execution rules

- Throw from `execute()` to report a tool error.
- Returning a value does not mark the tool as failed.
- Use `terminate: true` only when the current tool batch should skip the follow-up LLM call.
- For file-mutating tools, resolve the target path first and wrap writes with `withFileMutationQueue()`.

## UI rules

- Use `ctx.ui.select()`, `confirm()`, `input()`, `editor()`, and `notify()` for normal interaction.
- Use `ctx.ui.custom()` for richer TUI experiences.
- Check `ctx.hasUI` before prompting in non-interactive modes.

## State management

- Put replayable state in tool result `details`.
- Rebuild state from the current session branch on `session_start`.
- Do cleanup work in `session_shutdown`, not in random event handlers.

## Common patterns

- Permission gate: intercept `tool_call`, inspect the input, and block with a reason if needed.
- Prompt helper: use `before_agent_start` to prepend turn-specific guidance.
- Stateful tool: store the minimal replayable data in `details` and reconstruct from session history.
- Dynamic tools: register them during startup, after config load, or from a command handler.

## What to avoid

- Do not assume UI methods work in JSON, RPC, or print modes.
- Do not mutate file paths without normalizing them first.
- Do not put long-lived state only in memory if the tool needs to survive branching or reloads.
- Do not make the skill depend on compilation if a direct TypeScript module will do.
