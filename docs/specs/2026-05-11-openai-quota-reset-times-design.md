# OpenAI Quota Reset Times Design

## Problem

The `little-footer` OpenAI quota indicator currently shows each usage window as a duration plus the percentage remaining, such as `5h 43%`. This tells the user how much quota remains but not when that quota resets, forcing them to infer reset timing elsewhere.

## Goal

Show each OpenAI quota window's reset time in the footer when the ChatGPT Codex usage API provides it:

- `5h 43% (19:01)` for a 5-hour window that resets today at 19:01.
- `1w 47% (15 May 10:05)` for a 1-week window that resets on 15 May at 10:05.

Only show the date when the reset is not today. If the reset timestamp is unavailable or invalid, keep the existing fallback display.

## Design

### Rendering behavior

Each quota window remains a compact single-line token:

```text
<duration> <available-percent> (<reset-time>)
```

The reset suffix is optional:

- Same local calendar day as the current time: `(HH:MM)`.
- Different local calendar day: `(D Mon HH:MM)`.
- Missing or invalid reset timestamp: no suffix, preserving the current output.

The footer uses local time via JavaScript `Date`, matching the existing footer clock behavior.

### Components

The change stays inside the `little-footer` quota rendering boundary:

- Quota fetching and snapshot normalization already expose `resetsAt` in milliseconds.
- The quota segment renderer formats reset timestamps for display.
- The public quota tracker and footer wiring do not change.

This keeps the behavior isolated and testable without changing extension APIs.

### Error handling and fallback

The reset formatter treats non-finite timestamps as unavailable. When unavailable, the window renders exactly as it does today: duration plus percentage, or percentage only if the duration is unavailable.

### Testing

Update the existing quota segment tests to verify external rendering behavior:

- Today's reset omits the date: `5h 43% (19:01)`.
- Future non-today reset includes date: `1w 47% (15 May 10:05)`.
- Missing reset timestamp falls back to the existing display.
- Existing warning/error color behavior and dual-window rendering remain covered.

Tests should continue to live outside `extensions/`, following the repository convention.

## Out of Scope

- Changing the ChatGPT usage API call or snapshot shape.
- Adding timezone configuration.
- Showing relative reset countdowns.
- Changing non-OpenAI footer segments.
