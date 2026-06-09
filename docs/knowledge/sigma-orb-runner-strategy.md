# Sigma ORB Runner Strategy

Source: user-provided strategy note `sigma_orb_runner.md`.
Status: research/test strategy, not live.

Purpose: preserve the simpler ORB execution runner as Sigma/Nova strategy knowledge while the current backtests are still being refined. This strategy is useful as the mechanical baseline against which heavier ORB filters can be compared.

## Core Idea

Sigma ORB Runner is a 15 minute opening range breakout model for ES/NQ futures. It detects the 09:30-09:45 ET opening range, waits for the first close outside that range, calculates entry near the breakout bar midpoint, and emits Ghost-compatible webhook payloads.

Current flow described by the source:

```text
Pine Script -> TradingView alert -> Ghost webhook -> Tradovate broker
```

For Sigma production, this must be converted to:

```text
Pine Script -> TradingView alert -> Sigma API -> approval queue -> dry-run/paper review
```

No live broker execution is approved from this model.

## Inputs

| Input | Default | Notes |
|---|---:|---|
| ORB duration | 15 minutes | 09:30-09:45 ET on 5 minute chart. |
| Reward:risk | 2.0 | Take profit equals stop distance times RR. |
| Adaptive lookback | 30 days | Rolling ORB range average. |
| Range multiplier | 1.5 | Used when current range is abnormal. |
| Allowed days | Wed,Fri | Strategy is intentionally day-filtered. |
| Skip months | F,G,H | Contract month filter. |
| Manual month ban | false | Manual safety toggle. |

## Entry Model

Long setup:

1. Build the opening range from 09:30-09:45 ET.
2. Confirm the current day is allowed.
3. Confirm the contract month is not banned.
4. Wait for first close above ORB high.
5. Set entry at the midpoint of the breakout candle: `(high + low) / 2`.
6. Set stop below entry by adaptive stop distance.
7. Set target at `entry + stopDistance * RR`.
8. Emit a single alert and mark the day complete.

Short setup:

1. Build the opening range from 09:30-09:45 ET.
2. Confirm the current day is allowed.
3. Confirm the contract month is not banned.
4. Wait for first close below ORB low.
5. Set entry at the midpoint of the breakout candle: `(high + low) / 2`.
6. Set stop above entry by adaptive stop distance.
7. Set target at `entry - stopDistance * RR`.
8. Emit a single alert and mark the day complete.

## Adaptive Stop

The default stop distance is the current ORB range.

If at least `LOOKBACK` range samples are present:

- Calculate the average opening range.
- If current range divided by average is below `0.5` or above `2.0`, treat the day as abnormal.
- On abnormal days, use `averageRange * 1.5` as stop distance.

This is the most important rule to validate. It can protect against unusual opening ranges, but it may also blunt edge if the regime detection is too coarse.

## Reported Backtest Snapshot

User-provided Python backtester result:

| Contract | Trades | Avg/trade | Win rate | Period |
|---|---:|---:|---:|---|
| ES M6 | 22 | +361 | 55% | Jun 2026 |
| ES Z5 | 25 | +127 | 52% | Dec 2025 |
| ES U5 | 26 | +400 | 58% | Sep 2025 |
| Total | 73 | +295 | 55% | Mixed |

Treat this as a research snapshot only. The user is actively iterating because other backtests are negative, so this model needs broad validation before promotion.

## Webhook Payload Shape

Long:

```json
{"ticker":"CME_MINI:ES1!","direction":"LONG","entry_price":5512.5,"stop_loss":5502.25,"take_profit":5532.75}
```

Short:

```json
{"ticker":"CME_MINI:NQ1!","direction":"SHORT","entry_price":19550.0,"stop_loss":19565.5,"take_profit":19519.0}
```

## Sigma/Nova Guardrails

- Ghost/Tradovate execution is not enabled in current Sigma production.
- TradingView payloads should route to Sigma approval-only middleware.
- `TRADING_MODE` remains `dry-run`.
- Voice/Nova can explain or draft, but not execute.
- Massive futures OHLC should be used for cloud backtests and validation.
- MooMoo/OpenD remains local-only and is not the cloud CME data source.

## Validation Plan

1. Port the Pine rules into a deterministic Massive-backed backtester.
2. Test ES, NQ, MES, and MNQ separately.
3. Segment results by day of week, month code, opening range size, and volatility regime.
4. Compare against Blaq ORB MTF to decide whether MTF filters add edge or overfit.
5. Preserve negative variants and tag why they failed.
6. Only promote to production approval templates after out-of-sample and forward dry-run behavior agree.

## Journal Tags

- `model:sigma-orb-runner`
- `orb:15m`
- `entry:breakout-candle-midpoint`
- `risk:adaptive-orb-range`
- `filter:day-of-week`
- `filter:contract-month`
- `route:tradingview-sigma-approval`
- `status:research`
