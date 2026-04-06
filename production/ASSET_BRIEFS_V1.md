# Asset Briefs V1

Date: 2026-04-06
Scope: first production asset batch for the wormhole stage and the first two fighters

This is the production-facing brief set for the first content batch. It is the input to asset generation, review, cleanup, and integration.

## Brief 1: Wormhole Stage Support Pack

### Purpose

Create the visual support set for the signature gravity-well stage. The stage should feel like a deep, camera-facing aperture with slow twisting motion, not a planet, ring, or flat purple disc.

### Runtime surface

- Three.js stage background and atmosphere
- stage fog and lighting support
- particle and distortion textures

### Required outputs

- one hero reference image of the wormhole mouth
- one swirl or flow map
- one distortion mask
- one emission gradient
- one particle or dust atlas
- one review still that shows the assets behind fighter silhouettes

### Style notes

- large static mouth, hollow center, visible depth
- slow interior twist, not a spinning prop
- electric violet, cyan, blue-black, and faint magenta accents
- depth should read behind the playfield, not on top of it

### Technical constraints

- no Saturn-like planet
- no sideways ring across the arena
- no dense center fill
- no bright bloom that destroys fighter readability
- textures should be reusable in shader or procedural stage code

### Acceptance

- reads as a wormhole from one frame
- still looks like a gravity well while fighters move and launch
- can support launch zoom-outs without losing the starfield and depth read

## Brief 2: Vanguard

### Purpose

Produce the first defensive anchor character as a readable, heavy, reliable fighter. This character should feel like the stable baseline of the roster.

### Runtime surface

- current visual profile target: 3d
- select screen portrait
- training and combat silhouette
- guard and special feedback

### Required outputs

- one front-facing hero sheet
- one side or three-quarter pose sheet
- one portrait for select and online surfaces
- one guard pose reference
- one launch or counterpose reference
- one technical note for armor, silhouette, and color blocking

### Style notes

- heavy, deliberate, protected
- broad silhouette with obvious mass
- controlled shape language, no fragile outlines
- guard state must read immediately

### Technical constraints

- should support a 3d-friendly build path
- must remain readable if converted into hybrid or sprite support art later
- armor or body shapes should not create visual noise around the core silhouette

### Acceptance

- the character reads as defensive before any motion starts
- the portrait and in-game body feel like the same fighter
- guard and block language is obvious in static art and in motion

## Brief 3: Duelist

### Purpose

Produce the first pressure character as a fast, aggressive, forward-leaning fighter with clean motion read.

### Runtime surface

- current visual profile target: sprite
- select screen portrait
- combat sprite sheet or sprite-first reference set
- special and dash feedback

### Required outputs

- one character concept sheet
- one turnaround or strong pose sheet
- one portrait for select and online surfaces
- one dash or chase pose reference
- one launch and dunk read reference
- one technical note for frame readability and silhouette anchors

### Style notes

- faster, sharper, more kinetic than Vanguard
- forward lean and motion bias
- motion trails and slash language should fit the silhouette
- the character should feel like pressure, not glass fragility

### Technical constraints

- sprite frames must keep a stable anchor and scale
- motion should remain readable over the wormhole stage
- special or dash poses should not collapse the silhouette into a blur

### Acceptance

- the character reads as mobile and aggressive before input
- the portrait, motion poses, and in-game silhouette match
- attack and chase states remain readable at game distance

## Review Rule

No asset is approved unless it:

- matches the wormhole and character fantasy in the current production docs
- remains readable in motion
- can be named and stored inside the asset pipeline
- has an obvious runtime surface and integration target

