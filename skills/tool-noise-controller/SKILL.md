---
name: tool-noise-controller
description: Keep tool output readable by collapsing noisy results and summarizing them by default. Use when tool calls produce too much raw output or when the user wants a cleaner UX.
---

# Tool Noise Controller

Use this skill when tool output is too verbose or distracting.

## Workflow

1. Prefer a short summary before any raw tool output.
2. Keep noisy tool results collapsed or abbreviated by default.
3. Expand raw output only when the user asks for details.
4. When possible, group related tool calls and summarize the combined result.
5. If a tool is inherently noisy, suggest or implement a cleaner presentation pattern.

## Practical rules

- For search results, show the top relevant hits, not the full dump.
- For file reads, summarize the important sections first.
- For command output, extract the actionable part and omit repeated noise.
- For multi-step flows, report progress at the end of the step instead of streaming every internal detail.

## Guardrails

- Never hide important errors or failed commands.
- Do not suppress raw output when it is needed for debugging.
- Keep the UX compact, but preserve exact details when they matter.