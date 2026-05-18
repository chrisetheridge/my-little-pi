# Review Finding Categories Spec

## Goal

Add a required category to every structured `/review` finding so users can distinguish spec-compliance issues, codebase-standards issues, and general actionable review findings.

The change makes review output stricter, improves scanability in the review UI, and allows reviewers to filter findings by concern without changing persisted review-run ownership beyond storing the normalized finding data already held in memory.

## Background

The packaged `/review` extension runs a structured code review flow, extracts a `review-findings` fenced JSON block from assistant output, normalizes findings, displays them in an interactive TUI, and uses retained findings to build a fix prompt.

Today findings include severity, source location, title, explanation, suggested fix, optional note, and status. They do not distinguish why a finding matters. ADR `docs/adr/2026-05-18-review-finding-categories.md` proposes adding a user-facing `category` field so the UI and downstream fix prompt can separate spec, standards, and general concerns.

Relevant current modules:

- `extensions/review/findings.ts` owns raw finding validation, normalization, deterministic IDs, and source excerpt loading.
- `extensions/review/prompt.ts` owns review, formatter, and fix prompt contracts.
- `extensions/review/ui.ts` owns preflight, parse recovery, finding presentation, and finding actions.
- `extensions/review/state.ts` owns in-memory review-run state shape and finding updates.
- `extensions/review/README.md` documents extension behavior.

## Decisions

- Decision: Every raw and normalized review finding has a required `category` field.
- Source: ADR `docs/adr/2026-05-18-review-finding-categories.md`.
- Consequence: Missing or invalid categories are validation failures and enter the existing parse-recovery flow.

- Decision: Allowed categories are `spec`, `standards`, and `general`.
- Source: ADR `docs/adr/2026-05-18-review-finding-categories.md`.
- Consequence: Category normalization is strict; arbitrary category strings do not fall back silently.

- Decision: The field name is `category`, not `axis`.
- Source: ADR `docs/adr/2026-05-18-review-finding-categories.md`.
- Consequence: Prompt examples, TypeScript types, UI labels, and fix prompts use category terminology consistently.

- Decision: The formatter may infer categories during recovery.
- Source: ADR `docs/adr/2026-05-18-review-finding-categories.md`.
- Consequence: Normal review output remains strict, while malformed live output can be repaired by the existing formatter-model retry path.

- Decision: Category filtering is UI state, not persisted review-run state.
- Source: ADR `docs/adr/2026-05-18-review-finding-categories.md`.
- Consequence: Category selections affect the visible findings in the dialog only and are not saved into `ReviewRunState`.

## Scope

### In

- Add the `spec`, `standards`, and `general` category contract for review findings.
- Require and validate category in raw and normalized finding data.
- Include category in review and formatter prompt schemas and examples.
- Include category in fix prompt context.
- Show a visible category badge for each finding in the review UI.
- Add multi-select category filtering to the review UI.
- Keep empty category selection semantics as no filter, showing all findings.
- Update review extension documentation and tests.

### Out

- Changing review target selection modes.
- Changing severity semantics.
- Persisting UI filter selections across review runs or sessions.
- Creating issue-tracker workflow changes for findings.
- Adding product analytics around category usage.
- Renaming existing `severity`, `status`, or note concepts.

## Current Architecture

The `/review` command is registered by `extensions/review/index.ts`. It validates interactive mode, selected model, and git repository state, then asks the user to choose a review target. Target builders in `extensions/review/git.ts` provide a `ReviewTarget` with a label, changed files, and prompt context.

`buildReviewPrompt` in `extensions/review/prompt.ts` creates the model instruction and embeds the expected `review-findings` JSON shape. The review runs in a fresh session. `lastAssistantText` extracts the assistant response, `extractFindingsBlock` parses the fenced JSON block, and `normalizeFindings` converts raw findings into `ReviewFinding` objects.

If parsing or normalization fails, `showParseRecovery` offers retry extraction. Retry uses `buildFindingsFormatterPrompt` and the selected model to produce a corrected fenced block, then applies the same extraction and normalization path.

`buildInitialReviewState` stores the target, raw review output, normalized findings, and current index in an in-memory `ReviewRunState`. `showFindings` opens the review UI. `FindingsDialog` renders one selected finding at a time, supports navigation and discard/fix actions, and submits retained findings.

When submitted, `buildReviewFixPrompt` includes the retained finding details plus source excerpts. The fix session receives this prompt and makes code changes.

Current ownership boundaries:

- Finding schema and validation are owned by `findings.ts`.
- Prompt schemas are owned by `prompt.ts`.
- Review-run state is owned by `state.ts`.
- UI rendering, navigation, and action handling are owned by `ui.ts`.
- Recovery continues to use the same parse and normalization contracts as initial extraction.

## Target Architecture

Finding category becomes part of the stable review finding contract from model output through fix prompt generation.

`findings.ts` owns the canonical category union and validation. A raw finding must include `category`, and a normalized finding exposes category as a typed field. Category validation is strict and produces controlled errors suitable for the existing recovery UI.

`prompt.ts` updates both model-facing schemas:

- The review prompt requires `category` in each finding and defines the three allowed values.
- The formatter prompt requires `category` and explicitly allows inference when raw output omits or obscures it.
- The fix prompt includes category beside severity and location so the fixing model understands the review concern.

`ui.ts` presents category as a first-class user-visible badge. The findings dialog keeps local category filter state. The visible finding list is derived from retained findings plus the current filter selection. Selecting no categories means no category filter is applied.

`state.ts` continues to store normalized findings and current index. It does not persist filter selection. Existing finding update operations preserve category.

Deletion boundary: once all prompts, parsing, normalization, UI rendering, fix-prompt generation, docs, and tests require `category`, there is no compatibility path for category-less findings except formatter recovery before normalization.

## Contracts

### [ADDED] Finding category values

```ts
type FindingCategory = "spec" | "standards" | "general";
```

Semantics:

- `spec`: The implementation does not satisfy an available spec, requirement, or stated acceptance criterion.
- `standards`: The implementation violates repository conventions, documented standards, architecture, style, tests, or expected codebase patterns.
- `general`: An actionable correctness, safety, maintainability, or regression finding that is not clearly a spec or standards issue.

### [CHANGED] Raw finding shape

```ts
interface RawFinding {
  id?: string;
  severity?: string;
  category?: string;
  file?: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  title?: string;
  explanation?: string;
  suggestedFix?: string;
  note?: string;
}
```

`category` is syntactically optional in the raw TypeScript shape only because raw model output is untrusted before validation. Validation requires it to be present, a string, and one of the allowed values.

### [CHANGED] Normalized finding shape

```ts
interface ReviewFinding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  file: string;
  startLine: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
  title: string;
  explanation: string;
  suggestedFix: string;
  note?: string;
  status: FindingStatus;
}
```

`category` is required and typed after normalization.

### [CHANGED] `review-findings` JSON block

```json
{
  "summary": "Short summary string.",
  "findings": [
    {
      "id": "optional-short-human-readable-id",
      "severity": "critical|high|medium|low",
      "category": "spec|standards|general",
      "file": "path/relative/to/repo",
      "startLine": 1,
      "startColumn": 1,
      "endLine": 1,
      "endColumn": 1,
      "title": "Concise issue title",
      "explanation": "Why this is a problem",
      "suggestedFix": "Concrete remediation guidance"
    }
  ]
}
```

The parser accepts the same fenced block format. The finding schema inside the block now requires `category`.

### [CHANGED] Validation behavior

- Missing `category` fails normalization with a controlled validation error.
- Non-string `category` fails validation with a controlled validation error.
- String values outside `spec`, `standards`, and `general` fail validation with a controlled validation error.
- Validation failure uses the existing parse-recovery flow.
- The formatter recovery prompt may infer a valid category from finding content.

### [CHANGED] Stable finding identity

The stable finding identity may include category when needed to prevent conflating equivalent text/location findings with different review concerns.

At minimum, adding category must not make IDs unstable across repeated normalization of the same finding content and category.

### [ADDED] UI category badge

Each visible finding includes one badge:

- `Spec` for `spec`
- `Standards` for `standards`
- `General` for `general`

The badge appears alongside existing severity, status, file, and location context.

### [ADDED] UI category filtering

The findings dialog owns local filter state:

```ts
type CategoryFilterSelection = Set<FindingCategory>;
```

Filtering semantics:

- Empty selection shows all retained findings.
- Non-empty selection shows findings whose category is selected.
- Filtering never mutates the retained findings array.
- Current selection/index behavior remains bounded to the visible filtered list.

### [CHANGED] Fix prompt finding context

Each retained finding passed to the fix prompt includes category context, for example:

```text
1. [high] [standards] src/example.ts:42
Title: Repository convention violated
Why: ...
Suggested fix: ...
```

Exact formatting is implementation-defined, but category must be visible to the fixing model.

## Migration Plan

### Phase 1: Schema and prompt contract

- Change: Add the category type and validation contract to findings parsing/normalization, and update review and formatter prompt schemas.
- Compatibility: Existing category-less model output fails validation and enters formatter recovery. Formatter recovery can infer category before normalization.
- Acceptance criteria:
  - Missing category causes a controlled validation error.
  - Invalid category causes a controlled validation error.
  - Valid categories normalize to typed finding categories.
  - Review and formatter prompts require `category` and document allowed values.

### Phase 2: Downstream category propagation

- Change: Carry category through review state and fix-prompt generation.
- Compatibility: `ReviewRunState` continues to store normalized findings; no separate state migration is required for new in-memory runs.
- Acceptance criteria:
  - Retained findings keep category after note, discard, navigation, and submit actions.
  - Fix prompts include category for every retained finding.
  - Deterministic IDs remain stable for repeated normalization of identical category-bearing findings.

### Phase 3: Review UI presentation and filtering

- Change: Render category badges and add multi-select category filtering in the findings dialog.
- Compatibility: Filter state is local to the dialog and not persisted.
- Acceptance criteria:
  - Every visible finding shows the correct category badge.
  - Users can select one or more categories and see only matching retained findings.
  - Empty category selection shows all retained findings.
  - Navigation and discard/fix actions operate on the currently visible filtered findings without losing retained findings outside the filter.

### Phase 4: Documentation and regression coverage

- Change: Update review extension docs and tests for category contracts, prompt contents, fix prompts, badges, and filters.
- Compatibility: Documentation describes current category-required behavior only.
- Acceptance criteria:
  - Review README documents category meanings and filtering behavior.
  - Tests cover normalization, validation, prompt contracts, fix prompt context, badge rendering, and filtering semantics.

## Deletion Criteria

- There are no prompt examples or docs that omit `category` from finding objects.
- Tests no longer rely on category-less valid findings.
- Any temporary compatibility helpers for category-less normalized findings are absent or removed.
- Formatter recovery remains only as the general malformed-output recovery path, not as a silent normalizer for accepted category-less findings.

## Acceptance Criteria

- [ ] `FindingCategory` exists with `spec`, `standards`, and `general` values.
- [ ] Raw and normalized findings include required category validation.
- [ ] Missing or invalid categories fail with controlled validation errors and can trigger existing parse recovery.
- [ ] Review and formatter prompt JSON examples require `category` and explain allowed categories.
- [ ] Formatter recovery may infer category when repairing malformed raw output.
- [ ] Fix prompts include category context for each retained finding.
- [ ] Review UI renders `Spec`, `Standards`, or `General` badges for every finding.
- [ ] Review UI supports multi-select category filtering.
- [ ] Empty category selection shows all findings.
- [ ] Filter state is not persisted in `ReviewRunState`.
- [ ] Review extension docs describe category meanings and filtering.

## Testing Strategy

Use existing Vitest coverage under `tests/extensions/review/` and add focused tests around the changed contracts.

- Findings tests cover valid category normalization, missing category errors, invalid category errors, and stable ID behavior for category-bearing findings.
- Prompt tests cover review prompt schema, formatter prompt schema, formatter inference instructions, and fix prompt category context.
- UI tests cover category badge rendering, selected-subset filtering, empty-selection filtering, and action behavior while filtered.
- Extension-flow tests confirm malformed category output follows the existing recovery path.

Run the narrow review test suite first, then the package checks before completion:

```bash
pnpm vitest tests/extensions/review
pnpm run check
pnpm run test
pnpm run pack:dry-run
```

## Open Questions

- None.
