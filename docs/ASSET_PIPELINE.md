# Asset Pipeline

This document defines how AI-assisted assets should be produced, reviewed, and integrated into `Gravity Well`.

It is written for the current project shape:

- realtime Three.js stage rendering
- 2D or hybrid fighter presentation
- data-authored content packages
- build-time asset validation and budget checks

Use this as the default pipeline for new stage visuals, character visuals, VFX source assets, portraits, and promo media.

## Goals

- Keep shipped assets consistent even when source material comes from multiple AI tools.
- Separate raw generations from approved game assets.
- Make every accepted asset reproducible.
- Fit assets into the existing content, manifest, and validation flows.
- Use AI to accelerate ideation and draft production, not to bypass technical art and QA.

## Core rule

No AI-generated asset goes straight into shipped game content.

Every asset moves through:

1. brief
2. generation
3. review
4. cleanup
5. integration
6. validation

## Project folders

Use these folders for asset operations:

- `art/source`
  - raw generations, reference boards, work-in-progress outputs
- `art/workflows/comfyui`
  - saved ComfyUI workflows and notes
- `art/review`
  - candidate selects, feedback sheets, approval notes
- `apps/game-web/content`
  - approved game content only

Do not store raw generated assets directly under `apps/game-web/content`.

## Asset classes

### Realtime stage visuals

Examples:

- wormhole background
- fog layers
- distortion maps
- glow masks
- starfields
- portal particles

Preferred implementation:

- runtime shader or procedural scene logic in `apps/game-web/src/view`
- authored presets in `apps/game-web/content/stages`
- textures and supporting masks generated externally and reviewed before import

### Fighter visuals

Examples:

- idle, move, hit, launch, dunk, parry, break, special frames
- HUD portrait
- splash art
- sprite sheets
- hybrid aura layers

Preferred implementation:

- package-authored fighter content in `apps/game-web/content/characters`
- final runtime controlled through character packages and visual profiles

### VFX source assets

Examples:

- hit sparks
- boost flares
- projectile glows
- smoke wisps
- shock rings
- aura textures

Preferred implementation:

- source textures or flipbook frames authored externally
- runtime playback and tuning controlled in `apps/game-web/src/view/vfx`

### UI and promo assets

Examples:

- menu backgrounds
- character cards
- patch-note visuals
- reveal videos

Preferred implementation:

- static art or motion source assets generated externally
- promo video assembly via Remotion when needed

## Tool roles

### Codex

Use Codex for:

- art briefs
- prompt packs
- pipeline docs
- file naming conventions
- import scripts
- manifest and package integration
- validation scripts
- runtime implementation
- review checklists

### ComfyUI

Use ComfyUI for:

- concept art
- turnarounds and visual exploration
- texture generation
- VFX source frames
- portrait drafts
- background source images
- direct sprite experiments when useful

Store workflow JSONs under:

- `art/workflows/comfyui`

### Blender

Use Blender for:

- authored wormhole geometry, camera pitch, arena-lip look development, and lighting tests
- cleanup of generated 3D meshes
- retopo and simplification
- rigging
- camera setup
- rendering controlled sprite frames from 3D references
- baking turntables, emissive masks, particle flipbooks, or effect plates

Prefer a checked-in headless export script over a manual-only sequence. Pin the Blender version, scene units, camera, frame list, colour management, transparent background, output dimensions, and naming convention; run exports with `blender --background --python <script>`. Treat generated files as candidates until the presentation-manifest MIME, decoded-dimension, frame-bound, anchor, readiness, and memory-budget checks pass. Blender access improves repeatability and visual control, but it never becomes a simulation or rollback dependency.

### Aseprite or equivalent

Use Aseprite for:

- sprite cleanup
- frame timing
- palette cleanup
- sheet packing
- export tagging

### Remotion

Use Remotion for:

- trailers
- character reveal videos
- patch-note clips
- pre-rendered non-interactive sequences

## AI model strategy

Do not force one model to solve all asset needs.

Use the right class of model for the job:

- image models:
  - concept art
  - portraits
  - effects textures
  - sprite draft frames
- image editing models:
  - cleanup
  - pose corrections
  - consistent outfit or silhouette updates
- video or frame-sequence models:
  - rough motion ideation
  - non-final VFX loops
- 3D asset models:
  - proxy meshes
  - blockout references
  - rough character or prop shape exploration

Inference:

- for shipped fighters, direct text-to-sprite is acceptable for ideation, but controlled sprite production is safer
- for stages, shader-driven motion is more reliable than baking large animated backgrounds

## Recommended production lanes

## Lane A: Wormhole stage background

Target look:

- spinning 3D wormhole depth field
- color-shifting tunnel core
- soft fog or nebula atmosphere
- particles and energy streaks around gameplay space

Recommended production approach:

1. Build the main effect in code
- implement the wormhole as realtime scene logic or shader-driven distortion in `apps/game-web/src/view`
- keep speed, palette, contrast, and intensity data-driven

2. Generate support textures in ComfyUI
- swirl maps
- noise maps
- emission masks
- nebula overlays
- spark or debris sprite textures

3. Define stage parameters in content
- add or update presets in `apps/game-web/content/stages/atmospherePresets.ts`

4. Validate
- check performance in debug build
- confirm assets stay within budget
- verify readability against HUD and fighter silhouettes

Acceptance criteria:

- stage remains readable during combat
- background motion does not hide gameplay tells
- palette can be tuned without code rewrites
- imported textures pass budget review

## Lane B: 2D fighter sprite pipeline

Use this when the final in-game fighter is sprite-based or hybrid.

### Option 1: Controlled production from a master design

This is the recommended shipping path.

1. Generate concept and turnaround references
- use ComfyUI to explore:
  - silhouette
  - palette
  - costume language
  - face and portrait direction

2. Lock a character sheet
- front, side, back, close portrait, and action pose references

3. Build a controllable master
- either:
  - rig a 3D proxy in Blender
  - or rig a 2D cutout version in Spine or equivalent

4. Render/export animation frames
- idle
- walk or drift
- boost
- launch
- attack
- hit
- dunk
- victory

5. Clean and normalize
- trim frames
- align anchors
- unify scale
- keep consistent canvas sizes where possible

6. Export sheet and metadata
- deliver final approved sprite sheets for integration

Why this path is preferred:

- better pose consistency
- easier iteration
- easier costume revisions
- easier animation timing control
- less cleanup than fully direct generation

### Option 2: Direct sprite-sheet generation

Use this for:

- fast prototyping
- enemy variants
- VFX helpers
- temporary placeholders

Workflow:

1. generate candidate frame sets in ComfyUI
2. review and discard weak or inconsistent outputs
3. clean in Aseprite
4. normalize anchors and frame bounds
5. integrate as prototype-only unless quality is approved

Risk:

- inconsistency across frames is much higher
- harder to maintain exact move silhouettes
- fighting-game readability is easier to lose

## Lane C: VFX and particles

AI should create source materials, not final effect timing.

Recommended flow:

1. generate source textures or flipbook candidates
2. review for silhouette, brightness, and palette
3. trim and normalize
4. wire effect playback in runtime
5. tune effect timing in `presets.ts` and runtime systems

Examples:

- boost aura texture
- projectile glow sheet
- hit spark flipbook
- smoke cloud alpha
- ring shockwave mask

## Asset brief template

Every meaningful asset task should start with a brief in `art/review` or `docs`.

Minimum fields:

- asset id
- purpose
- target runtime surface
- camera distance
- required outputs
- style notes
- animation needs
- color constraints
- budget constraints
- acceptance checks

Example:

```text
Asset: wormhole_stage_core_v1
Purpose: Realtime stage background support textures for the wormhole arena.
Surface: Three.js stage shader and particle layers.
Outputs: 2048 noise map, 2048 emission mask, 1024 distortion map, 512 particle sprite atlas.
Style: high-energy cosmic tunnel, teal/cyan core, magenta edge accents, readable behind fighters.
Constraints: avoid dense central detail behind player silhouettes, avoid large white blooms.
Acceptance: readable in motion, loops cleanly, passes asset budget review.
```

## Review gates

### Gate 1: Style review

Check:

- silhouette clarity
- palette fit
- world consistency
- uniqueness

Reject if:

- too generic
- unreadable at game scale
- inconsistent with approved character or stage style

### Gate 2: Technical art review

Check:

- dimensions
- alpha quality
- anchor consistency
- seam issues
- compression suitability
- frame consistency

Reject if:

- uneven frame scale
- muddy edges
- unusable transparency
- excessive file weight

### Gate 3: Runtime integration review

Check:

- in-game readability
- HUD contrast
- performance
- visual noise during combat
- effect timing relative to gameplay

Reject if:

- important gameplay cues get obscured
- sprite scale feels unstable
- particles or backgrounds overpower the action

## Naming conventions

Use lowercase snake case for source and review artifacts.

Examples:

- `wormhole_noise_map_v1.png`
- `vanguard_portrait_select_a_v3.png`
- `boost_flare_flipbook_cyan_v2.png`
- `vanguard_idle_sheet_blockout_v1.png`
- `wormhole_stage_comfy_workflow_v1.json`

For approved game assets, keep ids aligned with package or manifest identifiers.

## Reproducibility rules

For every approved AI-assisted asset, keep:

- workflow file if available
- model family name
- important checkpoint or LoRA notes
- seed when useful
- negative prompt notes when useful
- cleanup steps
- final export settings

This does not need to live in the shipped content folder, but it must live somewhere in the repo or adjacent production storage.

## Integration rules for this repo

### Approved content goes here

- stage presets:
  - `apps/game-web/content/stages`
- themes:
  - `apps/game-web/content/themes`
- character packages:
  - `apps/game-web/content/characters`

### Runtime implementation goes here

- scene and rendering:
  - `apps/game-web/src/view`
- VFX playback:
  - `apps/game-web/src/view/vfx`
- asset manifest loading:
  - `apps/game-web/src/view/assets`

### Runtime readiness labels

Every manifest entry may declare `readiness`:

- `prototype`: temporary exploration or a technical placeholder; this is also the default when the field is omitted.
- `alpha`: reviewed, readable, budgeted, and acceptable for the controlled alpha.
- `production`: final approved shipping content.

Character-package QA requires every presentation asset, HUD portrait, and kit-required projectile texture to resolve at `alpha` or `production`. It separately verifies code-backed VFX and voice profile ids. Optional shared or unused package slots must be `null`; unresolved ids and prototype assets fail the alpha gate instead of receiving guessed fallback budgets.

### Validation already exists here

- budget checks:
  - `apps/game-web/scripts/asset-budget-check.ts`
- docs:
  - `docs/ASSET_BUDGET_VALIDATION.md`
  - `docs/ASSET_MANIFEST_LOADER.md`
  - `docs/CHARACTER_VISUAL_PROFILE_ABSTRACTION.md`
  - `docs/SPRITE_ATLAS_RUNTIME.md`
  - `docs/VFX_EVENT_BINDING_PRESETS.md`

## Agent workflow around assets

Use Codex in explicit roles:

1. Art Director
- write or refine the asset brief

2. Technical Director
- decide whether the asset should be:
  - procedural
  - sprite-based
  - hybrid
  - 3D-assisted

3. Asset Pipeline Agent
- define tools, output formats, and folder paths

4. Technical Artist Agent
- review candidate outputs and prep them for runtime

5. Integration Agent
- wire them into manifests, packages, or stage presets

6. QA Agent
- verify readability, budget, and runtime fit

## Example Codex requests

### Request: plan a new character

```text
Act as art director and technical artist.
Write a brief for a new fighter that will ship as 2D sprites over a 3D stage.
Then define the production pipeline from ComfyUI concept art to cleaned sprite sheets and runtime integration.
```

### Request: produce a wormhole stage plan

```text
Act as technical director first.
Decide which parts of the wormhole stage should be shader-driven and which parts should be generated as textures.
Then write the implementation plan and asset brief in docs.
```

### Request: use parallel sub-agents

```text
Use sub-agents.

Agent 1: create the technical brief and runtime integration plan for a wormhole stage.
Agent 2: create the asset generation brief for textures, particle sprites, and promotional key art.
You: merge them into one repo-local asset plan and call out risks.
```

## Immediate next actions for Gravity Well

1. Replace the temporary Vanguard and Duelist SVG atlases with reviewed transparent production atlases.
2. Add one reproducible source workflow under `art/workflows/comfyui` or the selected generation tool.
3. Produce one reviewed VFX flipbook and wire it through the existing VFX preset runtime.
4. Profile the shader-driven wormhole at alpha target resolution and hardware.
5. Capture gameplay-scale visual review images for both fighters and every required clip.

## Default decision guidance

For this project, default to:

- realtime background motion
- sprite or hybrid fighters
- runtime particle effects
- AI-generated source material with human cleanup

That is the safest route to a strong look without depending on brittle one-shot generation.
