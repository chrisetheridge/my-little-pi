---
name: linear-issue-to-atomic-commits
description: Convert a Linear issue or issue-driven prompt into researched, repo-grounded implementation work with explicit approach critique, optional subagent research/design support, verification, and atomic git commits. Use when the user gives a Linear issue key or URL and wants Codex to understand the ticket, inspect the repository, compare implementation approaches, push back on weak assumptions, implement the chosen approach, and commit clean logical increments.
---

# Linear Issue To Atomic Commits

Use this skill for issue-driven engineering work where the desired output is not just a patch, but a defensible approach and clean commit history.

## Operating Contract

- Read the issue and repository before proposing a fix.
- Treat the Linear issue as requirements, not as proof that a requested solution is correct.
- Keep the approach grounded in files, tests, data flow, and existing conventions in the current repo.
- Challenge weak requirements, over-broad scope, and risky implementation shortcuts.
- Use subagents only when they add parallel value; the main agent owns final judgment, edits, verification, and commits.
- Prefer small verified increments and atomic commits over one large patch.

## Phase 1: Intake And Repo Grounding

1. Read local instructions first: `AGENTS.md`, relevant nested instructions, package scripts, and obvious project docs.
2. Capture current git state with `git status --short`; do not overwrite unrelated user changes.
3. Read the Linear issue when an issue key or URL is provided:
   - title, description, acceptance criteria, comments, labels, status, links, and PR references
   - unresolved ambiguity or unstated constraints
4. Build a repo map before editing:
   - search with `rg`
   - inspect named files and nearby tests
   - inspect analogous implementations and shared helpers
   - trace the smallest relevant data flow from entry point to behavior
5. Write down the issue in one sentence and the likely affected surfaces.

IMPORATNT: Do not edit ANY files yet. You must NOT work on the issue until presenting your findings and approach.

### Linear Context Sources

Prefer the `linear` CLI from `schpet/linear-cli` when it is installed and already authenticated/configured for the repo.

Check availability without changing user state:

```bash
command -v linear
linear --version
```

Use it for issue context:

```bash
linear issue view ENG-123
linear issue comment list ENG-123
linear issue title ENG-123
linear issue url ENG-123
linear issue query --search "search terms" --json
linear issue query --all-teams --json --limit 0
```

If the current branch names the issue, `linear issue view`, `linear issue comment list`, `linear issue id`, `linear issue title`, and `linear issue url` may work without an explicit key.

Use the CLI output as primary issue evidence when available. Capture comments separately; comments often contain decisions, reversals, and hidden acceptance criteria not present in the description.

If `linear` is not installed, not authenticated, or not configured:
- Do not install packages, run `linear auth login`, or run `linear config` without explicit user permission.
- Fall back to the Linear MCP/app tools when available.
- If neither CLI nor MCP is available, continue from the user-provided issue text and state the missing context.

## Optional Subagents

Use subagents only when the user allows them or has already asked for them, and only for work that can run in parallel without blocking immediate local progress.

Good subagent tasks:
- "Find analogous implementations and tests for this behavior. Return file paths and the pattern."
- "Read this issue plus these files and identify risks or hidden acceptance criteria. Do not edit."
- "Compare approach A vs B against existing repo conventions. Cite files."

Avoid subagents for:
- the immediate next file edit
- final approach ownership
- committing
- tasks that require broad, vague repo exploration with no concrete output

When using subagents, ask for concise findings with file paths. Integrate, verify, and challenge their output locally.

## Phase 2: Approach Review With Pushback

Before implementation, present a short repo-grounded approach review unless the task is obviously trivial.

IMPORTANT: Do not write ANY code before presenting your approach.

Include:
- `Goal`: one sentence
- `Evidence`: files, tests, patterns, and issue details that matter
- `Approaches`: usually 2-3 options, including the smallest viable option
- `Critique`: risks, hidden coupling, missing tests, migration concerns, and what each approach fails to handle
- `Choice`: selected approach and why it best fits the repo
- `Challenge to user`: one or two pointed questions only if the choice depends on product intent or unacceptable risk

Push back when:
- the ticket asks for an implementation that conflicts with existing architecture
- acceptance criteria are too broad for a safe patch
- the obvious solution would duplicate state, bypass shared helpers, or make later migration harder
- tests would be too weak to prove the behavior
- a "quick fix" leaves user-visible or data integrity risk

If the user is waiting for implementation and the tradeoff is low-risk, make the decision and proceed. Do not stall on performative questions.

## Phase 3: Implement In Verified Slices

1. Start with the smallest test or reproduction that proves the required behavior when practical.
2. Edit only the files needed for the selected approach.
3. Prefer existing helpers, abstractions, and style over new patterns.
4. Keep refactors separate from behavior changes unless the refactor is needed to make the behavior safe.
5. After each meaningful slice:
   - run the narrowest relevant check
   - inspect the diff
   - commit if the slice is coherent and verified

If a slice fails verification, stop and debug the root cause before starting another slice.

## Phase 4: Atomic Commits

Commit after verified logical increments when the user asked for commits or the workflow calls for them.

Commit boundaries:
- one failing test or reproduction
- one implementation slice
- one focused refactor
- one docs or config update
- one follow-up fix from verification

Before every commit:
- run `git status --short`
- inspect `git diff` or `git diff --staged`
- stage only files belonging to that commit
- avoid staging unrelated user changes
- run the relevant focused verification for that slice

Commit message format:

```text
<type>: <specific change>

<why this change exists, when useful>
```

Use `fix`, `feat`, `test`, `refactor`, `docs`, or `chore`.

## Phase 5: Final Verification And Handoff

Before claiming completion:
- run focused tests for touched behavior
- run typecheck/lint/build when appropriate for the repo
- run the full relevant suite if the blast radius is unclear or the suite is cheap
- inspect final `git status --short`

Final response should include:
- what changed
- commit list with short hashes if commits were created
- verification commands actually run
- assumptions or remaining risks
- any Linear follow-up that still needs the user's decision

Do not hide failed or skipped checks.
