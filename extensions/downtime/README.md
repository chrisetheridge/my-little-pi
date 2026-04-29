# Downtime

Session policy extension that blocks or warns during a configured downtime window.

## What it does

- Reads downtime config from `~/.pi/agent/extensions/downtime.json` and `.pi/extensions/downtime.json`.
- Determines whether the current time is inside the active window.
- Injects downtime guidance into the assistant prompt.
- Blocks tool calls during the active window unless the confirmation command has been seen.
- Renders downtime state in the UI footer/status area.

## Config

Example `.pi/extensions/downtime.json`:

```json
{
  "time": "22:00",
  "durationMinutes": 480,
  "confirmCommand": "echo continue-downtime",
  "message": "Downtime is active. Pause work unless you intentionally continue with the confirmation command.",
  "statusLabel": "downtime"
}
```

## Fields

- `time`: start time in `HH:MM`
- `durationMinutes`: length of the window
- `confirmCommand`: command or chat input that confirms the current window
- `message`: prompt text shown while downtime is active
- `statusLabel`: label shown in the UI

## Notes

- Project config overrides global config.
- The `downtime` CLI flag can override the configured start time.
