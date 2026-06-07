# ComLucro HTF Flip Strategy

Source: user-provided video transcript.

Purpose: convert the transcript into a Sigma Bot training module for discretionary futures trade planning. This is an analysis framework only. Sigma Bot must still use deterministic risk checks, human approval, and post-trade journaling before any execution path is considered.

## Strategy Name

ComLucro HTF Flip Strategy

Also useful as:
- HTF Flip Zone Reversal Model
- Supply/Demand Flip Continuation-Reversal Model
- Premium/Discount Flip Entry Model

## Core Idea

The strategy waits for price to interact with a higher time frame point of interest, reject that area, flip the most recent lower time frame supply or demand zone, then return to the new flip zone for an entry confirmation on a lower time frame.

The model is built from seven concepts:

1. Market structure defines directional context.
2. Supply and demand zones are the origin candles of displacement that breaks structure.
3. Flip zones show control changing from supply to demand or demand to supply.
4. Liquidity sweeps often precede the real move.
5. Higher time frame zones decide whether a lower time frame signal is worth trading.
6. Premium and discount decide whether the setup is in a favorable location.
7. Entry confirmation comes from lower time frame structure shift, VSR, breaker block, or mitigation block behavior.

## Required Time Frames

Use three time frames:

- Higher time frame: identifies the dominant unmitigated area of interest.
- Main time frame: identifies structure, supply/demand zones, and the flip zone.
- Entry time frame: refines the trigger and risk placement.

Recommended futures-friendly combinations:

| Profile | Higher Time Frame | Main Time Frame | Entry Time Frame |
| --- | --- | --- | --- |
| Intraday scalp | M15 | M5 | M1 |
| Normal intraday | H1 | M15 | M1 or M3 |
| Session swing | H4 | M15 or M30 | M1 or M5 |

Backtest the exact combination before using it live.

## Market Structure Rules

Bullish structure:

- Price forms higher highs and higher lows.
- A break above the previous swing high is a bullish break of structure.
- The demand zone is the last down-close candle or down-close candle cluster at the origin of the bullish displacement that caused the break.

Bearish structure:

- Price forms lower highs and lower lows.
- A break below the previous swing low is a bearish break of structure.
- The supply zone is the last up-close candle or up-close candle cluster at the origin of the bearish displacement that caused the break.

Do not chase displacement. Mark the origin zone and wait for price to return.

## Liquidity Sweep Rules

Bullish sweep:

- Equal lows or obvious sell-side liquidity form during an uptrend or near higher time frame demand.
- Price trades below the lows, triggers stops, then quickly reverses.
- Confirmation requires a break above a meaningful swing high.
- Mark the origin zone of the bullish reversal and wait for return.

Bearish sweep:

- Equal highs or obvious buy-side liquidity form during a downtrend or near higher time frame supply.
- Price trades above the highs, triggers stops, then quickly reverses.
- Confirmation requires a break below a meaningful swing low.
- Mark the origin zone of the bearish reversal and wait for return.

Sweeps are context, not entries by themselves.

## Premium and Discount

Define the active dealing range before validating a flip setup.

Bullish range:

- Draw the range from swing low to swing high.
- With the Fibonacci convention from the transcript: zero at swing high, one at swing low.
- Above 50 percent is premium.
- Below 50 percent is discount.
- Longs are favored from discount when all other criteria align.

Bearish range:

- Draw the range from swing high to swing low.
- With the Fibonacci convention from the transcript: zero at swing low, one at swing high.
- Above 50 percent is premium.
- Below 50 percent is discount.
- Shorts are favored from premium when all other criteria align.

Range validity:

- Treat the range as dynamic while price keeps expanding.
- The range becomes more stable after a valid retracement reaches at least the 0.382 level.
- Avoid forcing premium/discount labels before the structure has a meaningful pullback.

## Flip Zone Definition

A flip is a small reaction to the latest supply or demand zone followed by an immediate breakout through that zone.

Important distinction:

- Every valid flip is a change of character.
- Not every change of character is a valid flip.

Valid flips are more useful than generic CHoCH signals because they provide a mechanical zone for return entries.

## Valid Flip Conditions

A flip is tradable only when all conditions are present:

1. Price first taps and rejects a higher time frame area of interest.
2. The higher time frame area is meaningful: unmitigated supply, unmitigated demand, or an unfilled fair value gap.
3. The main time frame shows a clear failure of the most recent opposing zone.
4. Price breaks and closes through that zone with displacement.
5. The flip leg leaves visible inefficiency or imbalance.
6. The flip zone is in the correct premium/discount location.
7. Price returns to the flip zone instead of entering late after displacement.
8. The entry time frame confirms reversal before entry.

Invalid flips:

- Flip forms in the middle of nowhere.
- No higher time frame mitigation or rejection.
- No strong displacement through the latest zone.
- Flip is only a liquidity inducement.
- Entry is taken without lower time frame confirmation.
- Long is in premium without exceptional context.
- Short is in discount without exceptional context.

## Bearish A+ Model

Use this when expecting a short trade.

Higher time frame:

1. Identify a bearish or rejecting context.
2. Mark the nearest fresh/unmitigated supply zone or bearish fair value gap.
3. Wait for price to tap the higher time frame supply area.
4. Require rejection from that area.

Main time frame:

1. Confirm price had been building demand zones during the push into higher time frame supply.
2. Wait for price to react down from the higher time frame supply.
3. Watch the most recent demand zone.
4. Require a small reaction from demand, then an immediate break and close below it.
5. The broken demand confirms a bearish flip.
6. The flip zone is the last up-close candle or up-close candle cluster at the origin of the bearish displacement.
7. Prefer the flip zone to sit in premium of the active range.
8. Wait for price to retrace back into the flip zone.

Entry time frame:

1. On tap of the main-time-frame flip zone, drop to the entry time frame.
2. Confirm sharp rejection, VSR, or market structure shift.
3. Optional confluence: breaker block or mitigation block forms after the entry-time-frame shift.
4. Place short entry at the breaker or mitigation block return.
5. Stop goes above the entry-time-frame higher high or above the flip zone invalidation point.
6. Target sell-side liquidity below the relevant swing low.

Bearish trade plan template:

- Bias: short.
- HTF POI: unmitigated supply or bearish FVG.
- Main trigger: latest demand flips to supply.
- Flip zone: last up-close candle(s) before bearish displacement.
- Location: premium.
- Entry trigger: entry-time-frame MSS, VSR, breaker block, or mitigation block.
- Stop: above entry-time-frame high or HTF flip invalidation.
- Target: sell-side liquidity.

## Bullish A+ Model

Use this when expecting a long trade.

Higher time frame:

1. Identify a bullish or rejecting context.
2. Mark the nearest fresh/unmitigated demand zone or bullish fair value gap.
3. Wait for price to tap the higher time frame demand area.
4. Require rejection from that area.

Main time frame:

1. Confirm price had been building supply zones during the pullback into higher time frame demand.
2. Wait for price to react up from the higher time frame demand.
3. Watch the most recent supply zone.
4. Require a small reaction from supply, then an immediate break and close above it.
5. The broken supply confirms a bullish flip.
6. The flip zone is the last down-close candle or down-close candle cluster at the origin of the bullish displacement.
7. Prefer the flip zone to sit in discount of the active range.
8. Wait for price to retrace back into the flip zone.

Entry time frame:

1. On tap of the main-time-frame flip zone, drop to the entry time frame.
2. Confirm sharp rejection, VSR, or market structure shift.
3. Optional confluence: breaker block or mitigation block forms after the entry-time-frame shift.
4. Place long entry at the breaker or mitigation block return.
5. Stop goes below the entry-time-frame lower low or below the flip zone invalidation point.
6. Target buy-side liquidity above the relevant swing high.

Bullish trade plan template:

- Bias: long.
- HTF POI: unmitigated demand or bullish FVG.
- Main trigger: latest supply flips to demand.
- Flip zone: last down-close candle(s) before bullish displacement.
- Location: discount.
- Entry trigger: entry-time-frame MSS, VSR, breaker block, or mitigation block.
- Stop: below entry-time-frame low or HTF flip invalidation.
- Target: buy-side liquidity.

## Entry Models

Breaker block entry:

- Wait for the entry time frame to create a swing sequence that traps the prior side.
- For shorts: price creates a high, a low, then a higher high, then closes below the key down-close candles. The breaker block is the down-close candle cluster used for the retest.
- For longs: invert the pattern. Price creates a low, a high, then a lower low, then closes above the key up-close candles.
- Enter on the return to the breaker block.

Mitigation block entry:

- Use the last opposing candle cluster at the origin of the entry-time-frame displacement.
- Enter on the return after market structure shifts in the intended direction.

VSR entry:

- VSR means a V-shaped rejection/recovery pattern.
- It is valid only when it happens after the higher time frame POI is tapped and the main time frame flip zone is revisited.
- VSR alone is not enough without structure alignment.

## Sigma Bot Checklist

Before Sigma Bot can label a trade as this model, it must answer every item:

- What is the higher time frame area of interest?
- Is that area unmitigated or otherwise high quality?
- Did price tap and reject that area?
- What is the main time frame trend before the flip?
- Which latest supply or demand zone failed?
- Did price close through the zone with displacement?
- Where is the flip zone?
- Is the flip zone in premium for shorts or discount for longs?
- Was liquidity swept before or during the reversal?
- Is there visible inefficiency in the flip leg?
- Did price return to the flip zone?
- What lower time frame confirmation appeared?
- Where is entry, stop, invalidation, and target liquidity?
- Does the trade satisfy deterministic risk rules and the active strategy profile?

## Scoring Rubric

Score each planned trade from 0 to 10.

Required base conditions:

- HTF POI tap and rejection: 2 points.
- Main time frame valid flip: 2 points.
- Correct premium/discount location: 1 point.
- Displacement and inefficiency: 1 point.
- Liquidity sweep or clear liquidity target: 1 point.
- Entry time frame MSS/VSR: 1 point.
- Breaker or mitigation block entry: 1 point.
- Minimum planned risk/reward of 2R and strategy risk compliance: 1 point.

Grade:

- 8 to 10: A setup.
- 6 to 7: B setup, paper trade or reduced size only.
- Below 6: no trade.

## Sigma Bot Response Style

When Sigma Bot identifies this model, it should produce:

1. Bias.
2. HTF context.
3. Main time frame flip description.
4. Premium/discount location.
5. Liquidity context.
6. Entry time frame confirmation.
7. Risk plan.
8. Invalidations.
9. Confidence score.

Example summary:

> Bias is short because price tapped fresh H4 supply and rejected. On M15, the latest demand zone failed after a small reaction, creating a bearish flip zone from the last up-close candle cluster. The flip zone is in premium, price has returned to it, and M1 shows a market structure shift with a breaker block. Stop is above the M1 higher high, target is sell-side liquidity, and the setup scores 8/10 before risk-engine checks.

## Hard Invalidations

Do not call this an A setup if:

- The higher time frame POI was never tapped.
- The zone was already heavily mitigated.
- Price does not close through the latest opposing supply or demand.
- The flip zone is far from premium/discount alignment.
- Entry is taken before the return to the flip zone.
- Stop placement is arbitrary or inside normal noise.
- Target is not tied to liquidity or structure.
- Risk engine rejects the position size, instrument, or account rule.

## Backtest Tags

Use these tags in journaling:

- model:comlucro-htf-flip
- htf-poi:supply
- htf-poi:demand
- flip:bearish-demand-to-supply
- flip:bullish-supply-to-demand
- location:premium
- location:discount
- entry:breaker-block
- entry:mitigation-block
- entry:vsr
- liquidity:sweep
- liquidity:target
- quality:a-plus
- quality:b-setup
- invalid:no-htf-tap
- invalid:no-displacement
- invalid:wrong-location
- invalid:no-entry-confirmation

