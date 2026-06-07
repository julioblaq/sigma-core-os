# Nova Response Contract v2

Owner: Jerry Hicks Jr.
Date: 2026-06-07
Status: Implemented for Tutor, Journal, and Draft flows.

## Purpose

Nova responses should make the current product mode obvious to both the trader and the dashboard. Every Nova surface should answer four questions:

- What mode is Nova in?
- Is this read-only, approval-only, warning, or blocked?
- What is Nova trying to do?
- Can the UI show highlights without blocking critical controls?

## Status Model

Nova-capable responses include:

```json
{
  "statusModel": {
    "mode": "tutor",
    "intentType": "explain",
    "riskState": "read_only",
    "executionState": "read_only",
    "confidence": "medium",
    "reason": "Screen-aware explanation only. Nova did not create or send an executable action.",
    "expiresAt": "2026-06-07T16:00:00.000Z",
    "highlightSafety": {
      "avoidCriticalControls": true,
      "blocksInteraction": false,
      "maxHighlights": 2,
      "fadeMs": 5200
    }
  }
}
```

## Modes

| Mode | Use | Execution state |
|---|---|---|
| `tutor` | Explain a screen, chart, DOM, ticket, or concept. | `read_only` |
| `draft` | Convert a voice trade idea into an approval record. | `approval_required` |
| `risk_coach` | Review sizing, stops, limits, and rule risk. | `read_only` or `approval_required` |
| `journal` | Capture notes, tags, screenshots, and setup context. | `read_only` |

## UI Rules

- Show a visible mode badge near the active Nova surface.
- Show a safety badge such as `read_only`, `approval_only`, `warning`, or `blocked`.
- Show the `reason` when Nova creates or blocks anything.
- Treat highlights as non-blocking UI hints.
- Fade highlights using `highlightSafety.fadeMs`.
- Never let highlight surfaces intercept clicks.

## Implemented Surfaces

- `POST /v1/nova/query`
- `POST /v1/nova/journal`
- `POST /v1/voice/draft-simulated-trade`
- Dashboard `/trading` Nova Voice Draft panel
