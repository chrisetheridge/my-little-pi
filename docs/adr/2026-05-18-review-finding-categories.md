# ADR: Add review finding categories

Date: 2026-05-18

## Status

Proposed

## Context

The packaged `/review` extension returns structured code review findings and presents them in the review UI. Issue #17 asks for review findings to distinguish between two review concerns:

- whether the code implements the spec, when a spec is available
- whether the code matches codebase standards

The UI should highlight these concerns differently and allow filtering. We also want to keep ordinary actionable review findings, so the model needs a third bucket for issues that are not specifically spec or standards related.

## Decision

Add a required `category` field to every review finding.

Allowed categories:

- `spec` — the implementation does not satisfy an available spec, requirement, or stated acceptance criterion.
- `standards` — the implementation violates repository conventions, documented standards, architecture, style, tests, or expected codebase patterns.
- `general` — an actionable correctness, safety, maintainability, or regression finding that is not clearly a spec or standards issue.

The field is user-facing as `category`, not `axis`.

The review prompt and formatter prompt will require `category` in the `review-findings` JSON schema. Missing or invalid categories should fail validation and use the existing recovery flow. During recovery, the formatter may infer the category from the finding content.

The review UI will:

- show a visible badge for every finding: `Spec`, `Standards`, or `General`
- provide multi-select category filtering
- treat an empty category selection as no filter, showing all findings
- keep filtering as UI state, not persisted review run state

## Consequences

- Findings become easier to scan by review concern.
- Users can focus review work on spec compliance, codebase standards, or general issues.
- Review output is stricter: every finding must include a valid category.
- The formatter becomes responsible for repairing missing categories in malformed live outputs.

## Implementation notes

Expected changes:

- Add `FindingCategory = "spec" | "standards" | "general"`.
- Add `category` to raw and normalized finding types.
- Validate `category` as required and reject invalid values.
- Include `category` in stable finding identity if needed to avoid conflating differently classified findings.
- Include `category` in review and formatter prompt JSON examples and instructions.
- Include category context in the fix prompt.
- Add UI badges and multi-select filtering in the review UI.
- Update review extension docs.

Expected tests:

- valid categories normalize correctly
- missing category throws a controlled validation error
- invalid category throws a controlled validation error
- review prompt requires category
- formatter prompt requires and may infer category
- fix prompt includes category
- UI renders category badges
- UI multi-select filtering supports selected subsets
- empty category selection shows all findings
