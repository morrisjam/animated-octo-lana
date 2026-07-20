# Release Crash Diagnostics

## Purpose

The release crash bundle is a small, versioned support artifact for reproducing failures without exporting personal data or arbitrary application logs. The implementation is intentionally not wired into `main.ts` yet.

Source modules:

- `apps/game-web/src/diagnostics/crashBundle.ts`
- `apps/game-web/src/diagnostics/crashBundleExport.ts`
- `apps/game-web/src/diagnostics/capabilities.ts`

Current schema: `gw.crash-bundle.v1`.

## Included Data

Every bundle requires the exact deterministic runtime identity:

- Build ID
- Ruleset version
- Balance profile ID
- Global tuning fingerprint
- Character-balance fingerprint
- Character-registry fingerprint

The remaining sections contain:

- A fixed failure category, lifecycle phase, safe error code, and recoverability flag
- Allowlisted gameplay, presentation, audio, graphics, and accessibility settings
- At most 240 recent accepted combat actions
- At most 160 recent fixed-schema events
- Replay payload version, integrity digest, and frame references without a session or match ID
- The latest checksum comparison
- Coarse renderer and device capabilities
- At most 120 relative-time performance samples

Input and event histories keep the latest valid records and silently discard malformed or unsupported records. They use `P1` and `P2`, never player account identifiers.

## Privacy Boundary

The builder copies fields through explicit allowlists. It does not accept a log object and then attempt best-effort redaction.

The schema explicitly excludes:

- Authentication, access, refresh, session, and bearer tokens
- Account IDs, participant IDs, email addresses, and display names
- Session, ticket, room, and match IDs
- IP addresses, hostnames, API origins, URLs, and ICE candidates
- Error messages, stack traces, breadcrumbs, console output, and free-form logs
- User-agent strings, GPU vendor strings, and GPU renderer names
- Arbitrary event metadata or notes

`assertCrashBundlePrivacySafe` runs during construction and again before serialization. It rejects forbidden field names and sensitive-looking strings, so later accidental schema expansion fails closed.

Renderer limits remain useful for support, but exact hardware counts are bucketed. The capability summary reports WebGL generation, numeric WebGL limits, fixed extension support flags, coarse device-pixel-ratio, processor and memory buckets, and reduced-motion preference.

## Integration Contract

The future crash boundary should maintain bounded action, event, and performance buffers during play. On a handled fatal error it should:

1. Convert the exception to a registered failure `category`, `phase`, and stable `code`. Do not pass its message or stack.
2. Supply the current release and deterministic balance fingerprints.
3. Supply persisted settings directly; the builder will retain only allowlisted values.
4. Reference the current replay by integrity digest and frame counts, not by online session identity.
5. Build the capability summary from safe renderer limits and coarse browser capability values.
6. Call `buildCrashBundle` and pass the result to an injected `CrashBundleExporter`.

`createCrashBundleExportFile` is pure and produces deterministic, newline-terminated JSON. `exportCrashBundle` accepts an injected save port for Steam or console shells. `createBrowserCrashBundleExporter` provides the opt-in browser download implementation.

Production integration must require an explicit player action before exporting. Bundles should remain local unless the player separately chooses to send them.

## Verification

Focused tests cover allowlisting, privacy rejection, exact identity, history limits, capability bucketing, replay/checksum references, and deterministic export:

```text
npx vitest run src/diagnostics/capabilities.test.ts src/diagnostics/crashBundle.test.ts
```
