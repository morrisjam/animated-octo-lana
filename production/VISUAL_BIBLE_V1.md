# Visual Bible V1

Date: 2026-04-06  
Scope: first playable slice, wormhole stage, fighter presentation, HUD/menu, VFX, asset review

## Purpose

This is the visual target for the first shippable slice of `Gravity Well`.

The game should read as:

- a fast, competitive arena fight
- suspended over a living gravity well
- neon, cosmic, and dangerous without becoming noisy
- clean enough to support high-speed readability

The bible is intentionally narrow. It exists to constrain AI-assisted generation and human review.

## Core Fantasy

The player is fighting on the lip of a deep, unstable wormhole.

The arena should feel like the visible surface of a larger collapse below it:

- the fight happens on top of a pit
- the well is always beneath the players
- the background suggests depth, pull, and motion
- the stage should feel static in structure and alive in texture

## Tone

Use these words as the emotional anchor:

- cosmic
- ritualized
- severe
- kinetic
- futuristic
- surgical

Avoid:

- cartoon chaos
- soft fantasy ornamentation
- overly cute or toy-like forms
- noisy sci-fi panels and clutter

## Palette

Primary palette:

- deep black and midnight blue for negative space
- electric violet for the wormhole body
- cyan and blue-white for cool energy and HUD support
- magenta/pink only for opposing player emphasis and damage read

Secondary palette:

- faint teal for fog/starfield variation
- warm orange only for impact sparks or high-severity state changes

Rules:

- keep the playfield darker than the fighters
- reserve high-saturation color for gameplay-relevant events
- never let the background overpower the actor silhouettes

## Shape Language

Overall language:

- circular apertures
- concentric depth rings
- tapered funnels
- clean hard silhouettes with soft energy falloff

Do:

- use one dominant central well
- use repeated rings sparingly and at different scales
- keep fighter silhouettes broad and instantly legible

Do not:

- stack many perfect circles near the center
- put a fake planet or satellite in the middle
- use sideways bands that read like a flat stripe
- rotate the entire stage as if it were a prop

## Wormhole Stage Direction

The stage is not a decorative background. It is the arena identity.

Target read:

- camera-facing mouth of a gravity well
- large static cone or shaft beneath the arena
- slow interior twist inside the well
- faint starfield visible behind and around the structure
- subtle fog and glow on the lip, not a solid disc

Specific stage rules:

- the center should remain hollow, not filled
- the mouth should be larger than a single prop ring but smaller than the full viewport
- the well should feel deep, with detail receding downward
- launch moments may intensify depth, but the geometry itself should stay static

Reference intent:

- closest to a black hole / wormhole aperture, not a planetary ring
- the fight sits above the opening, not inside a floating orb

## Fighter Presentation

The first slice should favor readability over technical ambition.

Recommended presentation:

- sprite-first or hybrid fighters
- strong silhouette separation
- clear team color treatment
- minimal but expressive idle motion

Character visual rules:

- each fighter should read at a glance from game distance
- one strong silhouette shape per character
- no thin, fragile outlines that disappear against the stage
- keep the body mass readable even when effects flare

Asset expectations:

- portrait for selection and online surfaces
- combat stance and idle read
- launch, boost, dunk, parry, and special response states
- visual profile compatibility with `3d`, `sprite`, or `hybrid` presentation

## HUD And Menu Direction

HUD and menu surfaces should frame the playfield, not compete with it.

HUD rules:

- use dark translucent panels with crisp edges
- keep text bright and compact
- avoid heavy chrome and oversized panel borders
- preserve the center of the screen for the fight

Menu rules:

- menus should feel like a control deck for a deep-space ritual
- transitions should be clean and intentional
- motion should be minimal, not floaty or decorative
- use one or two accent colors consistently across the flow

Accessibility rules:

- contrast must stay readable over the wormhole background
- any busy background needs a high-contrast fallback mode
- menu state should remain navigable with keyboard, mouse, and controller

## VFX Language

VFX should communicate force, direction, and impact.

Primary effects:

- boost: stretched streaks and energy bloom
- launch: upward burst with a sharp ring or flare
- parry: brief hard flash with controlled radius
- special: distinct identity per character, but same readability rules
- dunk: strongest impact cue, with collapse or pull effects

Rules:

- effects should be short-lived and readable
- prefer rings, streaks, sparks, and aura bursts over noisy particle clouds
- VFX should reinforce gameplay timing, not hide it
- use background effects to support the wormhole, not replace it

Support texture ideas:

- swirl maps
- noise masks
- emission gradients
- thin energy streak textures
- dust or star particles

## AI Asset Generation Rules

Use AI for exploration and source material, not for final approval by default.

Generation loop:

1. brief the asset clearly
2. generate multiple candidates
3. review for silhouette, palette, and readability
4. clean and normalize
5. integrate only approved output

Prompt discipline:

- give the stage or character one sentence of fantasy
- give palette limits up front
- specify what must stay visible in-game
- ask for variations around one locked direction, not open-ended novelty

## Asset Acceptance Rules

An asset is not approved unless it satisfies all of these:

- matches the visual bible and current stage direction
- keeps the gameplay read clear at game distance
- has a stable color and silhouette identity
- fits the asset manifest and budget constraints
- has a documented source, review note, and integration target
- does not introduce extra clutter into HUD or playfield

Reject if:

- it looks like a generic purple sci-fi orb
- it hides the fighters or launch states
- it uses too many competing focal points
- it cannot be cleanly named, budgeted, or reused

## First-Slice Deliverables

The first playable slice should ship with:

- one locked wormhole stage treatment
- one clear fighter visual language
- one menu/HUD theme
- one VFX language for core combat events
- one reviewable asset pipeline for AI-assisted generations

## Review Checklist

Before approving a new asset, ask:

1. Can I understand the silhouette in one second?
2. Can I still read the fighters over the stage?
3. Does this match the wormhole fantasy?
4. Is the palette doing useful work or just adding noise?
5. Can this be reproduced, named, and budgeted?
6. Does this improve the slice rather than widen scope?
