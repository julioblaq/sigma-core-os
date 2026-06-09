# ORB Strategy Validation Plan

Source strategies:

- Blaq ORB MTF
- Sigma ORB Runner

Status: active research. No live broker execution.

## Objective

Find whether the current ORB family has a durable futures edge before connecting it to any production alert path. The immediate goal is not to force a positive result; it is to identify which filters survive current market behavior.

## Current Hypotheses

1. A simple 15 minute ORB runner may outperform a heavily filtered model in some regimes because it trades more often and has less filter overfit.
2. MTF 200 EMA continuity may improve trend days but may underperform chop, reversal, and low-volume opens.
3. ORB midpoint stops reduce risk distance but may be too tight when the opening range is noisy.
4. Day-of-week and contract-month filters may be useful, but they are high overfit risk until validated across multiple contracts and years.
5. Massive futures OHLC should be the canonical cloud validation data source.

## Backtest Matrix

| Dimension | Values |
|---|---|
| Instruments | ES, NQ, MES, MNQ |
| Session | RTH |
| Time frame | 5 minute baseline |
| ORB windows | 5m, 15m, 30m, 60m |
| Entry mode | Close breakout, breakout candle midpoint, retest of ORB level |
| Stop mode | ORB midpoint, opposite ORB side, adaptive ORB range, previous candle |
| Target mode | 1.5R, 2R, 2.5R, trailing/hybrid |
| Filters | none, volume, 200 EMA, MTF continuity, S/R block |
| Day filter | all days, Wed/Fri, individual weekdays |
| Month filter | none, source skip list |

## Required Metrics

- Net P/L.
- Profit factor.
- Max drawdown.
- Win rate.
- Average trade.
- Median trade.
- Trades per month.
- Consecutive losses.
- Slippage sensitivity.
- Commission sensitivity.
- Out-of-sample performance.

## Promotion Criteria

A strategy can become a Sigma strategy profile only when:

1. It is positive across more than one contract window.
2. Profit factor remains acceptable after realistic slippage and commission.
3. Drawdown stays inside the active account or prop-firm limit.
4. Trade count is high enough to avoid one-month luck.
5. Forward dry-run alerts match the backtester logic.
6. Every alert routes to Sigma approval-only middleware.
7. Nova can explain the setup in read-only mode.

## Failure Tags

Use these when recording negative variants:

- `fail:overfit-day-filter`
- `fail:midpoint-stop-too-tight`
- `fail:mtf-filter-lag`
- `fail:low-trade-count`
- `fail:slippage-sensitive`
- `fail:chop-regime`
- `fail:trend-filter-blocked-winners`
- `fail:range-expansion-fakeout`

## Next Implementation Step

Build the Massive futures data adapter first, then use it to power a deterministic ORB backtest runner. MooMoo/OpenD stays local and should not be the CME futures data dependency.
