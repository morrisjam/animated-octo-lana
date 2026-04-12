# First Character Kit Targets

Date: 2026-04-06  
Scope: gameplay and character-package planning only

This document defines the first two kit passes for the current milestone. The goal is not to finish the whole roster. The goal is to lock two contrasting, shippable identities that exercise the current simulation, package, AI, training, and asset hooks.

## Why these two first

The current repo already defaults to `vanguard` versus `duelist`, and that pairing is useful:

- `vanguard` gives the defensive, stabilizing baseline
- `duelist` gives the pressure, chase, and punishing baseline

That split is enough to validate:

- timing differences in the shared frame-data registry
- special behavior contracts beyond the placeholder projectile
- character-specific AI profiles
- training telemetry that captures different play patterns
- VFX/audio hooks that must read clearly in opposite situations

## Pass 1: Vanguard

### Archetype

`Vanguard` is the defensive anchor and the safest first character. It should feel like the one player picks when they want to survive mistakes, reset spacing, and punish overextension.

### Gameplay identity

- best at stable approach control and reset play
- wins by denying bad entries, then converting into launch/dunk pressure
- should be readable, heavier, and less explosive than the pressure archetype
- should expose clear fuel management tradeoffs so defense is not free

### Move priorities

Priority order for tuning:

1. `parry`
2. `break`
3. `launch`
4. `dunk`
5. `movement`
6. `special`

### Likely special behavior contract

`Vanguard` is the best candidate for `special.block_guard.v1`.

Reason:

- it reinforces the defensive fantasy
- it gives us a special that is not just another projectile
- it is a good test of guard duration, cooldown, and counterplay timing

Contract shape to aim for:

- `kind: "block"`
- `behaviorId: "special.block_guard.v1"`
- short active window with strong response clarity
- cooldown long enough that it cannot replace parry or normal defense
- block state should preserve enough movement identity that the character does not become stationary glue

### Tuning goals

- higher survivability than the average character
- slower acceleration and less explosive burst than the pressure character
- defense should buy space, not guarantee advantage forever
- special fuel cost should be meaningful so the player has to choose between block, boost, and chase
- launch reward should be solid but not the highest in the roster

### AI / training implications

- AI profile should bias toward conservative spacing and punish windows
- training presets should emphasize anti-approach, parry timing, and reset drills
- telemetry should watch how often the character escapes pressure versus overuses defensive options
- replay fixtures should include guard, counter, and forced-approach situations

### Asset / audio / VFX hooks

Needs a strong but restrained presentation:

- silhouette should read as heavy, deliberate, and grounded
- VFX should emphasize shield, pulse, barrier, or impact absorption language
- audio should favor low, stable, reassuring hits and a distinct guard cue
- HUD portrait should communicate reliability rather than speed
- projectile visual can remain minimal if the special is block-based

## Pass 2: Duelist

### Archetype

`Duelist` is the pressure and momentum character. It should feel faster, sharper, and more punishing when it gets a clean read.

### Gameplay identity

- best at forcing movement mistakes and converting them into chase pressure
- wins by creating repeated offense cycles and making the opponent spend fuel defensively
- should feel more mobile and more aggressive than `Vanguard`
- should reward committed reads without becoming a pure glass cannon

### Move priorities

Priority order for tuning:

1. `movement`
2. `launch`
3. `special`
4. `dunk`
5. `boost`
6. `parry`

### Likely special behavior contract

`Duelist` is the best candidate for `special.movement_dash.v1`.

Reason:

- it matches the pressure fantasy
- it creates a distinct movement-enhancing special for matchup pressure and repositioning
- it helps validate fuel cost, dash distance, and commitment timing differently from `Vanguard`

Contract shape to aim for:

- `kind: "movement"`
- `behaviorId: "special.movement_dash.v1"`
- clear startup so it can be challenged
- enough dash displacement to create pressure, not free escape
- meaningful fuel cost and recovery so it is an offense tool, not a universal reposition button

### Tuning goals

- faster approach and better chase than the defensive character
- higher reward on successful launch-to-dunk conversion
- slightly weaker defensive safety than `Vanguard`
- special should be strong enough to define matchup pace, but not so strong that it bypasses spacing rules
- boost interaction should feel central to the kit identity

### AI / training implications

- AI profile should bias toward approach, pursuit, and offense conversion
- training presets should focus on chase routes, punish confirms, and spacing into launch
- telemetry should watch whether the character becomes too reliant on boost-special loops
- replay fixtures should include pressure continuations, escape attempts, and fuel-starvation situations

### Asset / audio / VFX hooks

Needs a more aggressive and kinetic presentation than `Vanguard`:

- silhouette should read as agile and forward-leaning
- VFX should emphasize motion trails, slash streaks, and burst timing
- audio should hit faster and brighter, with sharper attack cues
- HUD portrait should communicate momentum and confidence
- if the special uses dash effects, the VFX needs a clear start, travel, and recovery read

## Shared validation rules for both passes

Both characters should still fit the current architecture:

- live in `apps/game-web/src/sim/characters.ts` or a package override with the same schema
- conform to `docs/CHARACTER_PACKAGE_SCHEMA.md`
- use move timings from `docs/MOVE_FRAME_DATA_REGISTRY.md`
- use one allow-listed special behavior contract from the schema
- keep AI behavior deterministic and testable
- expose meaningful differences in training telemetry and frame-data overlay

## Acceptance bar for the pair

This pair is ready for the next milestone only when:

- `Vanguard` and `Duelist` feel different in neutral, pressure, and defense
- their special behaviors are not both generic projectiles
- the first training drills can expose their strengths and weaknesses
- the balance team can tune them without editing sim flow code
- the art/audio team can build clear visual and sound languages around each identity

## Next character work after these two

Only after this pair is stable should we move to:

- `Ace` for mobility and risk
- `Warden` for control and space denial

Those two should be built on the same package and validation rules, but they are not the first calibration pair.
