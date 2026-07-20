# Vanguard Sprite V1 Review

Status: local online-alpha candidate

## Direction

- broad defensive silhouette with visibly greater mass than Duelist
- ivory ceramic armour, graphite joints, petrol-teal structure, mint shield energy, and small amber charge points
- permanent left-arm crescent shield and enlarged right impact gauntlet as class anchors
- one reusable Blender proxy across every frame to prevent model and costume drift

## Runtime contract

- atlas: `512 x 256` PNG with eight `128 x 128` transparent frames
- portrait: `256 x 256` transparent PNG
- frame order: idle A, idle B, boost, launch, guard/break, special, dunk, helpless/recover
- anchor: unchanged at `0.5, 0.1`
- world size: unchanged at `7.4 x 7.4`

## Local checks

- Blender `5.2.0 LTS` source completed headlessly
- two consecutive unchanged source runs produced byte-identical runtime atlas, runtime portrait, review atlas, review portrait, and metrics files
- every pose is fully inside its frame
- atlas and portrait transparent corner alpha is `0`
- representative body alpha is `255`
- source, concept, runtime files, dimensions, byte counts, and SHA-256 values are captured in `vanguard_sprite_v1.metrics.json`
- `npm run character:sprite-source-validate` verifies that provenance and the presentation manifest without requiring Blender in CI

## Review limits

- this is a controlled proxy-render alpha asset, not final hand-cleaned character art
- gameplay-scale launch, defensive, dunk, and helpless tells still require browser review over the live wormhole
- target-hardware readability and motion review remain required before production approval
- the previous SVG atlas and portrait remain the immediate content rollback
