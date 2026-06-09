# Blaq ORB MTF Strategy

Source: user-provided strategy note `blaq_orb_mtf.md`.
Status: research/test strategy, not live.

Purpose: preserve the multi-timeframe ORB model as Sigma/Nova strategy knowledge while backtests are still being refined. This strategy must remain analysis-only until Massive-backed data validation, forward dry-run behavior, and journal/performance review support it.

## Core Idea

Blaq ORB MTF combines an opening range breakout with higher-time-frame 200 EMA continuity. It is designed for ES/NQ futures on a 5 minute chart and uses the first RTH opening range as the trade location.

The model can enter from:

- ORB breakout.
- 200 EMA cross.
- 200 EMA continuation.
- ORB or 200 EMA cross.

## Default Session And Instruments

| Item | Default |
|---|---|
| Instruments | ES, NQ, MES, MNQ |
| Chart | 5 minute |
| Session | RTH |
| ORB window | 09:30-09:45 ET |
| Holds overnight | No |
| EOD flatten | 15:55-16:00 ET |

## Required Filters

| Filter | Default | Notes |
|---|---:|---|
| MTF continuity | On | Uses Day, 4H, 1H, and 30M trend alignment. |
| EMA length | 200 | Applied across time frames. |
| EMA slope | Required | Default slope lookback is 3 bars. |
| Confirmed HTF candles | On | Avoids repaint from incomplete higher-time-frame candles. |
| Alignment | All enabled TFs | Alternative is at least 3 of 4. |
| Relative volume | On | Volume must exceed SMA(20) times multiplier. |
| Volume multiplier | 1.2 | Tune per instrument. |
| S/R block filter | Off | Optional block on breakouts into nearby support/resistance. |

## Entry Model

Long setup:

1. ORB high and low are finalized after the selected opening range.
2. Higher-time-frame continuity is bullish.
3. 200 EMA slope aligns with the long side when enabled.
4. Relative volume confirms participation.
5. Price closes outside the ORB or triggers the configured EMA condition.
6. Risk engine confirms stop distance, position size, and daily loss constraints.

Short setup:

1. ORB high and low are finalized after the selected opening range.
2. Higher-time-frame continuity is bearish.
3. 200 EMA slope aligns with the short side when enabled.
4. Relative volume confirms participation.
5. Price closes outside the ORB or triggers the configured EMA condition.
6. Risk engine confirms stop distance, position size, and daily loss constraints.

## Risk Model

| Setting | Default |
|---|---:|
| Exit mode | Hybrid |
| Initial stop | ORB midpoint |
| Fixed target | 2R |
| ATR trailing buffer | ATR x 0.25 |
| Max daily loss | 500 dollars |
| Max trades per day | 3 |
| Quantity | 2 contracts |
| Commission | 0.55 per contract |
| Slippage | 1 tick |

The midpoint stop is a core design choice. It reduces stop distance compared with the opposite side of the range, but it can also increase stop-out frequency when the opening range is noisy.

## Reported Backtest Snapshot

User-provided NQ result:

| Metric | Value |
|---|---:|
| Net P/L | +3549 |
| Win rate | 46.8% |
| Profit factor | 1.777 |
| Max drawdown | -1000 |

Treat this as a reference snapshot only. It is not a production approval. The current strategy work is still in active testing, and negative backtests must be investigated before any live workflow.

## Alert Payload Shape

Entry payloads:

```json
{"strategy":"Blaq ORB MTF","ticker":"{{ticker}}","timeframe":"{{interval}}","direction":"LONG","entry_price":0}
```

```json
{"strategy":"Blaq ORB MTF","ticker":"{{ticker}}","timeframe":"{{interval}}","direction":"SHORT","entry_price":0}
```

Exit payloads:

```json
{"strategy":"Blaq ORB MTF","ticker":"{{ticker}}","timeframe":"{{interval}}","direction":"EXIT_LONG"}
```

```json
{"strategy":"Blaq ORB MTF","ticker":"{{ticker}}","timeframe":"{{interval}}","direction":"EOD_FLATTEN"}
```

## Sigma/Nova Guardrails

- No broker execution from this strategy.
- TradingView alerts must enter Sigma as approval-only plans.
- `TRADING_MODE` must remain `dry-run` while testing.
- Use Massive futures OHLC data for cloud validation instead of MooMoo CME data.
- MooMoo/OpenD remains local-only for broker/session gateway behavior.
- All test trades should be journaled with strategy tags.

## Validation Plan

1. Rebuild the strategy in a deterministic backtester using Massive CME OHLC data.
2. Compare Blaq ORB MTF against Sigma ORB Runner over the same ES/NQ periods.
3. Track results by contract, day of week, ORB range regime, volume regime, and MTF alignment mode.
4. Preserve negative backtest variants instead of deleting them; they identify the rules that do not survive current market behavior.
5. Promote only if profit factor, drawdown, trade frequency, and slippage assumptions remain stable across out-of-sample windows.

## Journal Tags

- `model:blaq-orb-mtf`
- `orb:breakout`
- `filter:mtf-continuity`
- `filter:200-ema`
- `filter:relative-volume`
- `exit:hybrid-trailing`
- `risk:orb-midpoint-stop`
- `status:research`
