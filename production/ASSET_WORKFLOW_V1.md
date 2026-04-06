# Asset Workflow V1

Date: 2026-04-06
Scope: first production asset batch

This document turns the asset briefs into a repeatable production flow. Use it for the wormhole stage, the first two fighters, and any related VFX source work.

## Storage rules

- Raw generations go in `art/source`
- Saved generation workflows go in `art/workflows/comfyui`
- Selected candidates and approval notes go in `art/review`
- Approved runtime content goes into the game content tree only after review and validation

Do not skip the review folder. Raw output and approved output must stay separated.

## Production roles

- Art director: owns fantasy, silhouette, palette, and final approval
- Technical artist: owns cleanup, export settings, file size, and runtime fit
- Production lead: owns sequence, dependencies, and signoff
- Reviewer: confirms the asset still matches the brief after cleanup and import

## Batch order

Use this order for the current slice:

1. wormhole stage support pack
2. Vanguard character brief and reference set
3. Duelist character brief and reference set
4. shared VFX source pack for launch, boost, parry, and dunk
5. cleanup, validation, and import

## Workflow steps

### 1. Brief

- start from the production brief
- lock the runtime surface
- lock the required outputs
- lock the rejection criteria before generating anything

### 2. Generate

- produce several candidates
- keep the generation set narrow around one visual direction
- save everything that might be useful for review, but do not promote anything yet

### 3. Review

- compare candidates against silhouette, palette, readability, and runtime fit
- reject anything that looks generic, noisy, or off-model
- write a short note for the chosen direction

### 4. Cleanup

- normalize scale and framing
- trim empty space and broken edges
- reduce noise where it hurts readability
- prepare final export sizes and alpha behavior

### 5. Integrate

- move approved assets into the correct content or manifest location
- keep filenames aligned with the runtime identifiers
- keep source notes and workflow references alongside the approved asset record

### 6. Validate

- check budget impact
- check readability in-game
- check that the asset still fits the current production brief

## Naming rules

Use lowercase snake case for source and review files.

Examples:

- `wormhole_stage_support_pack_v1.png`
- `wormhole_distortion_mask_v1.png`
- `vanguard_portrait_exploration_v1.png`
- `duelist_character_sheet_v1.png`

## Prompt rules

- one sentence for the fantasy
- one sentence for the runtime surface
- one sentence for the must-not-happen list
- one sentence for the acceptance target

Avoid open-ended prompts that invite style drift.

## Signoff checklist

Before an asset moves out of review, answer yes to all of these:

- is the fantasy obvious?
- is the silhouette readable?
- does the palette help rather than clutter?
- is the runtime target clear?
- is the asset still within the budget and review rules?

