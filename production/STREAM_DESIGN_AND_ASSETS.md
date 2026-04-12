# Design / Assets Stream Plan

This is the studio-style execution plan for the design, content, art, audio, and presentation side of `Gravity Well`.

The goal is to turn the current prototype into a shippable content pipeline, not just a set of one-off assets.

## Operating model

Use the `Claude-Code-Game-Studios` idea as the template:

- director level: visual direction, content scope, acceptance bar
- lead level: art direction, technical art, audio direction, menu/HUD direction
- specialist level: sprites, 3D, VFX, audio, promo, validation
- explicit handoffs: brief -> draft -> review -> cleanup -> integration -> validation

Codex stays the orchestration layer. Asset tools are production tools, not the source of truth.

## Current state

The repo already has the right technical hooks for content work:

- character visual profiles and presentation modes in `apps/game-web/src/sim/characters.ts` and `docs/CHARACTER_VISUAL_PROFILE_ABSTRACTION.md`
- data-driven VFX event binding in `docs/VFX_EVENT_BINDING_PRESETS.md`
- typed audio routing in `docs/AUDIO_EVENT_BUS_ROUTING.md`
- asset manifests and budget checks in `docs/ASSET_MANIFEST_LOADER.md` and `docs/ASSET_BUDGET_VALIDATION.md`
- character package schema and QA in `docs/CHARACTER_PACKAGE_SCHEMA.md` and `docs/CHARACTER_KITS.md`
- menu and stage presentation knobs in `docs/MENU_THEME_WORKFLOW.md`, `docs/STAGE_ATMOSPHERE_PRESET_WORKFLOW.md`, and `docs/ASSET_PIPELINE.md`

What is still missing is a full content production loop with consistent art direction, approved asset sets, and a repeatable import/review process.

## Main gaps

- no locked visual style bible for characters, UI, VFX, and stage backgrounds
- no finalized hero asset set for the first ship-ready characters
- no complete fighter production pipeline for sprite, hybrid, or 3D presentation
- no approved audio pack for combat, menu, and voice callouts
- no content review board for asset acceptance, naming, and budget signoff
- no ship-ready promo pipeline for trailers, screenshots, and release media

## Stream goals

1. Define the visual language of the game.
2. Produce the first shippable character/content set.
3. Build a repeatable AI-assisted asset pipeline that still passes human review.
4. Keep every shipped asset tied to a manifest, budget, and validation gate.

## Roles

- Creative Director: owns the fantasy, tone, and what the game should feel like.
- Art Director: owns silhouette, palette, readability, and final approval.
- Technical Artist: owns asset cleanup, formats, budgets, manifests, and import rules.
- UI/Motion Designer: owns menus, HUD motion, stage presentation, and transition timing.
- VFX Designer: owns impact language, hit readability, and data-driven effect tuning.
- Audio Designer: owns combat cues, voice language, music state, and mix targets.
- Production Lead: owns sprint order, handoffs, and acceptance tracking.

## Workstreams

### 1. Character content

Target outputs:

- first playable roster with consistent identity
- per-character package assets
- portraits, splash cards, and select screen art
- supported presentation mode per character: `3d`, `sprite`, or `hybrid`
- concrete production briefs for the first two characters

Primary anchors:

- `docs/CHARACTER_PACKAGE_SCHEMA.md`
- `docs/CHARACTER_VISUAL_PROFILE_ABSTRACTION.md`
- `docs/CHARACTER_KITS.md`

Acceptance gates:

- each character has a validated package
- each character has a portrait and select-ready presentation
- each character has approved move/VFX/audio asset references
- each character stays within asset budget

### 2. Stage and environment art

Target outputs:

- the wormhole/gravity-well stage becomes a real visual identity
- stage atmosphere presets cover gameplay readability
- background support textures are generated and approved
- concrete production brief for the wormhole support pack

Primary anchors:

- `docs/STAGE_ATMOSPHERE_PRESET_WORKFLOW.md`
- `docs/ASSET_PIPELINE.md`

Acceptance gates:

- stage background does not hide gameplay tells
- motion remains readable at launch zoom-out
- palette and contrast can be adjusted from data

### 3. VFX language

Target outputs:

- boost, launch, parry, projectile, and dunk all have tuned looks
- hit, launch, and special feedback are readable at speed
- support textures are reusable across characters and stages

Primary anchors:

- `docs/VFX_EVENT_BINDING_PRESETS.md`

Acceptance gates:

- every combat event has a tuned default preset
- character overrides exist only when needed
- active effects remain under budget in gameplay and training

### 4. Audio identity

Target outputs:

- combat cue set
- menu and match state music
- voice/callout palette
- mix targets and ducking rules

Primary anchors:

- `docs/AUDIO_EVENT_BUS_ROUTING.md`

Acceptance gates:

- each major combat event has an audio cue path
- music state transitions are intentional
- voice and SFX do not mask gameplay readability

### 5. Menus and presentation

Target outputs:

- menu theme set
- motion pass for panel transitions
- HUD polish and accessibility presets
- marketing-ready screen composition

Primary anchors:

- `docs/MENU_THEME_WORKFLOW.md`
- `docs/ASSET_PIPELINE.md`

Acceptance gates:

- menus feel deliberate, not default
- HUD remains readable on top of dense stage art
- controller, mouse, and keyboard flow match

## Dependencies

This stream depends on stable contracts from the mechanics stream:

- character ids
- move ids and frame windows
- special behavior ids
- VFX event names
- audio event names
- asset budget thresholds

It should not depend on final netcode or ranked infrastructure.

## Sprint shape

### Sprint 1: Visual bible and hero set

Deliverables:

- one-page visual direction brief
- character silhouette rules
- UI color and contrast rules
- wormhole stage reference pack
- first hero character asset list

Exit criteria:

- the team can tell what is allowed and what is not
- the first content set has a clear approval bar

### Sprint 2: Asset pipeline and first production pack

Deliverables:

- approved ComfyUI workflow set
- naming and folder conventions
- one complete character content package
- one complete stage atmosphere pack
- one VFX source pack

Exit criteria:

- assets move from source to review to game content without ad hoc handling
- validation scripts catch missing or oversized content

### Sprint 3: Polish and ship readiness

Deliverables:

- menu/HUD motion pass
- audio pass for combat and match flow
- promo stills or trailer source assets
- asset review checklist and signoff flow

Exit criteria:

- the game reads as a coherent product, not a prototype with placeholder art
- content can be produced again without resetting the workflow

## Acceptance gates for the stream

- every shipped asset has a source, review note, and integration path
- every asset family has a budget check or review rule
- every character can be produced through the same content process
- stage, VFX, audio, and menu art all share one visual language

## Immediate next actions

1. Write the one-page visual bible for the game.
2. Define the first ship-ready character and asset checklist.
3. Lock the stage art direction for the wormhole/gravity-well look.
4. Create the content review checklist for asset approval and budget signoff.
5. Produce the first wormhole, Vanguard, and Duelist production briefs and workflow notes.
