---
description: Summarize completed work and next steps
argument-hint: "[instructions]"
---
Wrap up your work.

Additional instructions: $ARGUMENTS

Determine context from the conversation history first.

Rules for context detection:
- If the conversation already mentions a GitHub issue, PR, or Linear issue, use that existing context.
- If there is no GitHub issue, PR, or Linear issue in the conversation history, treat this as ad-hoc work.

Unless I explicitly override something in this request, do the following:

1. Summarize what changed and why.
2. List files changed.
3. Note any tests or checks run, and any that still should run.
4. Call out unfinished work, risks, or follow-ups.
5. Suggest the next best action, if there is one.

Keep the result concise and practical.