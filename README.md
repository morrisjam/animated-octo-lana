# Gravity Well (Three.js Prototype)

A browser-playable local 1v1 prototype inspired by your Gravity Well design scope.

## Run locally

```bash
python3 -m http.server 4173
# then open http://localhost:4173
```

## Mechanics included

- Gravity-well arena with orbital movement around a dangerous center.
- Fuel as a shared combat resource for movement pressure, super boost, projectiles, and dunks.
- Standard boost (fuel-free commit movement toward opponent).
- Super boost (zig-zag burst that consumes fuel by distance + direction changes + non-commit penalty).
- Projectile stun opener.
- Close-range launch into helpless launch state.
- Screen wrap on ring-out with fuel penalty.
- Limited launch breaks.
- Parry windows with mistime/end-lag risk.
- Dunk finisher interaction and fuel-pressure win condition.
- Dynamic camera follow + zoom to keep both players in view.
- HUD for fuel, launch breaks, and combat state.

## Controls

- **P1**: `WASD` move · `F` boost · `G` super boost · `R` projectile · `T` launch · `Y` dunk · `H` parry · `J` launch break
- **P2**: `IJKL` move · `O` boost · `P` super boost · `[` projectile · `]` launch · `\` dunk · `'` parry · `;` launch break

## Notes

This is intentionally a focused vertical slice/prototype rather than a full production game. It is built to prove the core combat loop and feel in Three.js quickly.
