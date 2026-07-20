# Duelist Sprite V1 Review

Status: local online-alpha candidate

## Direction

- narrow forward-biased silhouette that remains visibly lighter than Vanguard
- near-black navy body, cobalt armour, cool-silver edge plates, hot-coral energy, and small ice-blue instruments
- fixed swept left shoulder vane, integrated right forearm lance, and three-prong left kinetic claw as class anchors
- one reusable Blender proxy across every frame to prevent model and costume drift

## Runtime contract

- atlas: `512 x 256` PNG with eight `128 x 128` transparent frames
- portrait: `256 x 256` transparent PNG
- frame order: idle A, idle B, boost, launch, parry/break, dash special, dunk, helpless/recover
- anchor: unchanged at `0.5, 0.1`
- world size: unchanged at `6.5 x 7.2`

## Local checks

- Blender `5.2.0 LTS` source completed headlessly
- two consecutive unchanged source runs produced byte-identical runtime atlas, runtime portrait, review atlas, review portrait, and metrics files
- every body, lance tip, claw, and shoulder vane remains inside its frame with filtering margin
- source, shared helper, concept, runtime files, dimensions, byte counts, and SHA-256 values are captured in `duelist_sprite_v1.metrics.json`
- `npm run character:sprite-source-validate` verifies that provenance and the presentation manifest without requiring Blender in CI

## Review limits

- this is a controlled proxy-render alpha asset, not final hand-cleaned character art
- gameplay-scale launch, parry, special, dunk, and helpless tells still require browser review over the live wormhole
- target-hardware readability and motion review remain required before production approval
- the previous SVG atlas and portrait remain the immediate content rollback
