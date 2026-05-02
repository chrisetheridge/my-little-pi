# Downtime

Session policy extension that warns during a configured downtime window and asks for explicit continuation.

## What it does

- Reads downtime config from `~/.pi/agent/extensions/downtime.json` and `.pi/extensions/downtime.json`.
- Determines whether the current time is inside the active window.
- Injects downtime guidance into the assistant prompt.
- Shows an overlay dialog as soon as a session enters an unconfirmed downtime window.
- Lets the user accept and continue work, or press Escape and stop the pending tool.
- Keeps the confirmation command as a fallback confirmation path.
- Renders downtime state in the UI footer/status area.

## Config

Example `.pi/extensions/downtime.json`:

```json
{
  "time": "22:00",
  "durationMinutes": 480,
  "confirmCommand": "echo continue-downtime",
  "message": "Downtime is active. Pause work unless you intentionally continue.",
  "statusLabel": "downtime"
}
```

## Fields

- `time`: start time in `HH:MM`
- `durationMinutes`: length of the window
- `confirmCommand`: fallback command or chat input that confirms the current window
- `message`: prompt and overlay text shown while downtime is active
- `statusLabel`: label shown in the UI

## Notes

- Project config overrides global config.
- The `downtime` CLI flag can override the configured start time.
