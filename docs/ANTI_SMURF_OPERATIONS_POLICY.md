# Anti-Smurf Operations Policy

Date: 2026-02-14  
Status: active policy for web + Steam rollout

## Purpose
- Reduce obvious smurfing impact on ranked fairness.
- Keep enforcement auditable and reversible.
- Minimize false positives with staged actions.

## Signals (Heuristics)
- Placement overperformance:
  - New or recently placed account with sustained high win rate and large rating deltas.
  - Fast tier climb with low total ranked matches.
- Skill-gap anomalies:
  - Repeated matches where ranked matchmaking diagnostics show large `matchedGap` near expanded limits.
  - Frequent wins against much higher-rated or master-track opponents immediately after account creation.
- Match cadence anomalies:
  - Extremely high ranked match volume in short windows compared to account age.
  - Repeated same-opponent farming patterns.
- Behavioural flags:
  - High forfeit rates from opponents in repeated pairings.
  - Shared device/network evidence across multiple high-skill fresh accounts (where available).

## Detection Pipeline
1. Daily automated query computes risk scores from:
   - ranked progression deltas,
   - queue diagnostics (`skillTrack`, `expectedGap`, `matchedGap`, `waitSeconds`),
   - season leaderboard movement.
2. Accounts above threshold are tagged `review_pending`.
3. Operations triages within 24 hours.
4. Ranked anomaly alert stream (`ranked_anomaly_alerts`) is reviewed using `docs/RANKED_ANOMALY_REVIEW_FLOW.md`.

## Escalation Stages
1. Soft monitor:
   - No player-facing action.
   - Increased sampling for 7 days.
2. Matchmaking containment:
   - Narrower ranked search band for flagged account.
   - Priority matching against similarly flagged or high-confidence skilled accounts.
3. Provisional extension:
   - Additional calibration matches required before full league stability.
4. Enforcement:
   - Temporary ranked lock (24h to 7d) for repeated confirmed abuse.
   - Permanent ranked ban only after manual review and audit sign-off.
   - Use enforcement action APIs and appeal workflow documented in `docs/ENFORCEMENT_TOOLING_FLOW.md`.

## False-Positive Safeguards
- No hard enforcement from a single heuristic.
- Require at least two independent signal groups before restrictive action.
- Manual reviewer must record:
  - evidence snapshot,
  - decision rationale,
  - planned expiry/recheck date.

## Audit and Appeals
- Every action must store actor, timestamp, reason, and evidence pointers.
- Appeals reviewed by a separate operator from original decision when possible.
- Reversed decisions trigger heuristic tuning review.

## Tuning Cadence
- Weekly:
  - review top 50 flagged accounts,
  - measure precision/recall proxy (confirmed vs dismissed),
  - adjust thresholds.
- Seasonal:
  - rebaseline heuristics using season-wide distribution changes.
