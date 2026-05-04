## ADDED Requirements

### Requirement: Provider abstraction
The extension SHALL use an issue provider abstraction for detecting, resolving, and fetching external issue metadata.

#### Scenario: Provider detects a reference
- **WHEN** the user provides an issue reference or URL
- **THEN** each registered provider can report whether it supports that reference

#### Scenario: No provider supports reference
- **WHEN** no registered provider supports the provided reference
- **THEN** the extension reports a concise unsupported-reference error and does not start a metadata fetch

#### Scenario: Provider returns normalized metadata
- **WHEN** a provider successfully fetches an issue
- **THEN** it returns normalized metadata containing provider ID, canonical issue ID, display key, title, URL, status, assignee, description, associated pull requests, labels, and relevant timestamps when available

#### Scenario: Provider-specific details
- **WHEN** a provider has useful metadata that is not part of the normalized fields
- **THEN** it may include provider-specific details without requiring focused issue UI or prompt injection code to depend on provider-specific shapes

### Requirement: Linear reference support
The Linear provider SHALL support Linear issue URLs and team-key issue identifiers, regardless of the team key prefix.

#### Scenario: Linear issue key
- **WHEN** the user provides `ENG-123`
- **THEN** the Linear provider recognizes the reference as a Linear issue key candidate and attempts to resolve it

#### Scenario: Non-ENG Linear issue key
- **WHEN** the user provides `PLAT-987`
- **THEN** the Linear provider recognizes the reference without requiring the `ENG` prefix

#### Scenario: Linear URL
- **WHEN** the user provides a Linear issue URL
- **THEN** the Linear provider extracts the issue identifier or URL slug needed to fetch the issue

#### Scenario: Invalid Linear-like input
- **WHEN** the user provides malformed input that cannot be resolved to a Linear issue
- **THEN** the Linear provider returns a typed failure that the focused issue command can show to the user

### Requirement: Asynchronous provider fetch
Provider fetches SHALL run asynchronously and be cancelable without blocking agent startup or execution.

#### Scenario: Focus starts fetch
- **WHEN** the user sets a focused issue
- **THEN** the extension starts provider resolution in the background and returns command control promptly

#### Scenario: Agent starts during fetch
- **WHEN** an agent turn starts while provider metadata is still loading
- **THEN** the provider fetch continues independently and the agent start hook does not await it

#### Scenario: Fetch cancellation
- **WHEN** the focused reference changes or the extension shuts down
- **THEN** the active provider fetch receives cancellation and its result is ignored

#### Scenario: Fetch error
- **WHEN** the provider cannot fetch metadata because credentials, network access, or remote data are unavailable
- **THEN** the provider returns an error state that preserves the original reference and can be retried

### Requirement: Associated pull request metadata
The Linear provider SHALL include associated pull request metadata when Linear exposes it for the issue.

#### Scenario: Pull requests exist
- **WHEN** a Linear issue has associated pull requests
- **THEN** normalized metadata includes each pull request title or number, URL, status when available, and source repository when available

#### Scenario: Pull requests absent
- **WHEN** a Linear issue has no associated pull requests
- **THEN** normalized metadata represents the pull request list as empty without treating it as an error
