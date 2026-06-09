# Sigma ORB Runner Backtest

Status: research-only. No broker execution.

## Purpose

This runner validates the Sigma ORB Runner strategy against Massive futures OHLC bars in the cloud. It is designed to answer whether the ORB rules have a durable edge before any alert template is promoted.

## API

```text
POST /v1/backtests/orb-runner
```

Example body:

```json
{
  "ticker": "ESU6",
  "windowStartGte": "2026-06-01",
  "windowStartLte": "2026-06-09",
  "resolution": "5min",
  "settings": {
    "allowedWeekdays": "all",
    "slippageTicks": 1,
    "commissionPerContract": 0.55
  }
}
```

## Baseline Rules

- Uses 5 minute futures bars from Massive.
- Builds the opening range from 09:30-09:45 ET.
- Takes the first close outside the opening range.
- Sets entry at the breakout candle midpoint.
- Evaluates exits starting on the next candle.
- Uses current ORB range as default stop distance.
- Applies adaptive stop distance after enough ORB range history exists.
- Uses 2R target by default.
- Takes one trade per session.
- Flattens at the configured EOD time if neither stop nor target hits.

## Default Filters

- Allowed weekdays: Wednesday and Friday.
- Skipped contract month codes: F, G, H.
- Contracts: 1.
- Slippage: 0 ticks.
- Commission: 0.

These defaults match the captured Sigma ORB Runner note. Use `allowedWeekdays: "all"` for broad baseline testing before trusting the day filter.

## Ambiguity Handling

If a later candle contains both stop and target, the trade is marked `ambiguousExit: true` and resolved stop-first. This is intentionally conservative and prevents the runner from overstating edge on coarse bars.

## Output

The result includes:

- Summary metrics.
- Trade list.
- Day-level skipped/no-signal/traded statuses.
- Weekday breakdown.
- Contract month breakdown.
- Notes describing the assumptions.

## Guardrails

- This runner does not create approvals.
- This runner does not create orders.
- This runner does not touch Ghost, Tradovate, MooMoo, or OpenD.
- Massive is the cloud market-data source.
- M1/MooMoo/OpenD remains local-only.
