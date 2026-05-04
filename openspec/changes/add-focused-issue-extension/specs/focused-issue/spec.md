## ADDED Requirements

### Requirement: Focused issue command
The extension SHALL provide commands that allow the user to set, clear, refresh, and inspect the active focused issue.

#### Scenario: Set focus from an issue reference
- **WHEN** the user runs `/focus-issue ENG-123`
- **THEN** the extension records `ENG-123` as the active focused issue reference and starts resolving it asynchronously

#### Scenario: Set focus from requested alias
- **WHEN** the user runs `/set-focused-issue ENG-123`
- **THEN** the extension behaves the same as `/focus-issue ENG-123`

#### Scenario: Clear focus
- **WHEN** the user runs `/focus-issue clear`
- **THEN** the extension clears the active focused issue and removes the sticky issue UI

#### Scenario: Refresh focus
- **WHEN** the user runs `/focus-issue refresh` while an issue is focused
- **THEN** the extension starts a new asynchronous metadata refresh for the active focused issue

#### Scenario: Show current focus
- **WHEN** the user runs `/focus-issue show` while an issue is focused
- **THEN** the extension displays the current normalized issue metadata or the current loading/error state

### Requirement: Sticky focused issue UI
The extension SHALL render a sticky below-editor terminal widget whenever a focused issue is active and interactive UI is available.

#### Scenario: Issue metadata is loading
- **WHEN** a focused issue has been set and metadata has not finished loading
- **THEN** the sticky UI shows the issue reference and a loading state without blocking user input or agent execution

#### Scenario: Issue metadata is available
- **WHEN** focused issue metadata has been fetched successfully
- **THEN** the sticky UI shows the issue title, status, assignee, URL, description summary, associated pull requests, and useful labels or timestamps when available

#### Scenario: Issue metadata failed to load
- **WHEN** focused issue metadata fetch fails
- **THEN** the sticky UI keeps the active reference visible and shows a concise error with a refresh path

#### Scenario: Non-interactive mode
- **WHEN** the extension runs without interactive UI support
- **THEN** the extension does not attempt to render the sticky UI and still maintains focused issue state for command and prompt behavior

### Requirement: Prompt context injection
The extension SHALL inject focused issue context into the next agent turn after focus is set or explicitly refreshed for reinjection.

#### Scenario: Metadata ready before next agent turn
- **WHEN** a focused issue has fetched metadata that has not yet been injected
- **THEN** the next `before_agent_start` hook returns a compact custom message with the normalized issue context

#### Scenario: Metadata pending before next agent turn
- **WHEN** a focused issue is still loading during the next `before_agent_start` hook
- **THEN** the extension does not wait for the remote fetch and may inject only the focused reference and pending status

#### Scenario: Avoid repeated injection
- **WHEN** focused issue context has already been injected for the current focus version
- **THEN** subsequent agent turns do not receive the same full issue context again

#### Scenario: Focus changes
- **WHEN** the user focuses a different issue
- **THEN** the extension marks the new focus as eligible for prompt context injection

### Requirement: Focused issue lifecycle
The extension SHALL keep focused issue state consistent across extension lifecycle events.

#### Scenario: Extension shutdown
- **WHEN** the session or extension shuts down while a metadata fetch is in progress
- **THEN** the extension cancels the in-flight fetch

#### Scenario: Superseded fetch completes
- **WHEN** a metadata fetch completes for a reference that is no longer focused
- **THEN** the extension ignores that result and does not update the sticky UI or prompt context

#### Scenario: Extension reload
- **WHEN** the extension reloads and replayable focused issue state is available
- **THEN** the extension restores the active focus and renders the sticky UI from the latest known snapshot
