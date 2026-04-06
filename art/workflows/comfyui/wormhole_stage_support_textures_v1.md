# Wormhole Stage Support Textures V1

Purpose: generate the support textures for the wormhole stage brief

## Inputs

- wormhole stage brief
- wormhole reference stills
- dark cosmic palette constraints
- no-planet / no-horizontal-ring rejection rules

## Outputs

- swirl or flow map
- distortion mask
- emission gradient
- particle or dust atlas
- optional hero still for review

## Workflow notes

- keep the aperture hollow
- keep the center readable
- bias for slow twist rather than a flat ring
- generate multiple candidates around one locked direction

## Cleanup notes

- remove noisy center details
- trim alpha where it hurts readability
- normalize scale for runtime use

