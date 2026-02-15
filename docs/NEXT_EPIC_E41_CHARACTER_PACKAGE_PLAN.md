# Next Epic Plan: E4.1 Character Package System

Date: 2026-02-15  
Priority: P0 (first content production epic)

## Why this epic is first
- It creates the pipeline needed to add custom characters safely without rewriting core sim code.
- It establishes validation and determinism guardrails before content volume increases.
- It becomes the base format reused by later visual, dialogue, and music epics.

## Scope
- `S4.1` Character package schema and validator.
- `S4.2` Runtime package loader and registry integration.
- `S4.3` Deterministic custom move behavior contract.
- `S4.4` Character package scaffolding and docs.
- `S4.5` Character package QA harness.

## Definition of done for the epic
- New character can be added through a package directory only (no sim code edits required for standard cases).
- Package validation runs in CI and blocks merge on schema or determinism failures.
- Character appears in menus, loads in match, and passes replay checksum smoke checks.

## Execution order
1. `S4.1` schema + validator
- Deliverables:
  - Versioned package schema (identity, visuals, audio, mechanics, moves, metadata).
  - CLI validator with clear file/path field errors.
  - CI hook to validate all packages.

2. `S4.2` runtime loader
- Deliverables:
  - Package discovery/loading at boot from content directory.
  - Registry merge path into character select and sim.
  - Safe fallback path for invalid package (exclude package, log diagnostics).

3. `S4.3` deterministic move contract
- Deliverables:
  - Allow-listed behavior ids mapped to deterministic sim handlers.
  - Validation for unsupported behavior ids.
  - Unit coverage for deterministic behavior outputs.

4. `S4.4` scaffolding + docs
- Deliverables:
  - Scaffolder script (`new character package`).
  - Template package with placeholders and comments.
  - Authoring guide for required fields and assets.

5. `S4.5` QA harness
- Deliverables:
  - Package-level replay checksum smoke tests.
  - Frame-data and balance-bound checks.
  - Asset budget checks per package with report output.

## Risks and mitigations
- Risk: package schema churn creates migration pain.
  - Mitigation: include explicit schema version and migration helper policy from day one.
- Risk: custom move logic breaks determinism.
  - Mitigation: behavior-id allow list only; no arbitrary script execution.
- Risk: content regressions in menus/render.
  - Mitigation: package smoke test boots menu + match load path.

## Immediate next story
- Start `S4.1` now:
  - Create package schema types.
  - Implement package validator script.
  - Add CI validation command and one example package fixture.
