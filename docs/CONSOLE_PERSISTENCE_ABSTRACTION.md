# Console-Safe Persistence Abstraction

Original date: 2026-02-15
Updated: 2026-07-20
Story: `S3.7` Console-safe persistence abstraction

## Goal
- Give platform clients one asynchronous, user-scoped persistence contract.
- Make quota, conflict, corruption, and storage failures explicit rather than throwing through gameplay code.
- Express atomic replacement intent without claiming browser storage provides console-grade atomic writes.
- Preserve current web and Steam behavior while call sites migrate away from the synchronous interface.

## Current Contract
`PlatformPersistenceService` is exposed on `PlatformServices` in `apps/game-web/src/platform/types.ts`.

Primary asynchronous methods:
- `read(key, { userId, scope, legacySources })`
- `write(key, value, { userId, scope, expectedRevision, intent })`
- `delete(key, { userId, scope, expectedRevision })`
- `getQuota({ userId, scope })`

Behavior:
- Every primary operation requires a non-empty `userId` and stores data in a physical per-user namespace.
- `expectedRevision` provides optimistic concurrency. A stale write/delete returns `status: "conflict"` with expected and actual revisions.
- Results carry key, user, scope, physical key, revision, payload size, timestamp, write intent, and atomicity metadata.
- Failures carry a stable code, operation, retryability, cause name where available, and quota/conflict details.
- `cloud` remains unsupported by the web and Steam adapters and returns an explicit failure.

## Atomic Write Intent
The storage-backed adapter uses a recoverable two-phase replace:
1. Write a complete, validated intent envelope beside the target.
2. Replace the target envelope.
3. Remove the intent.

A later read/write/delete validates and completes an interrupted intent. Web and current Steam adapters report `recoverable_replace`; this is not represented as a platform-atomic guarantee. A future console adapter may report `platform_atomic` only when its SDK save API guarantees that behavior.

## Quota Behavior
- The service reports per-user bytes when the adapter can enumerate its storage.
- Web also uses `navigator.storage.estimate()` when available for origin-level usage and quota estimates.
- Quota is checked against the peak space required by the temporary intent plus replacement data.
- Browser quota exceptions are returned as `quota_exceeded` with a quota snapshot.
- Current Steam memory storage has no authoritative limit and reports an unknown limit; a native durable Steam adapter is still required.

## Compatibility Migration
The old synchronous methods remain as deprecated shims:
- `readJson`
- `writeJson`
- `remove`

The web runtime dual-writes immediate legacy saves and the recoverable scoped store during the rollback-compatible migration window. The web and Steam async adapters automatically recognise these logical keys:
- `settings` copies from `gravity_well.settings.v1`.
- `arcade_history` copies from `gravity_well.arcade_history.v1` at the game integration layer.
- Web `profile` copies from `gravity_well.profile.<userId>`.
- Steam `profile` copies from `profile.<userId>`.

Legacy values are retained by default so old and new builds can coexist during rollout. Callers can explicitly request removal after a successful migration once rollback compatibility no longer requires the old key. A failed copy returns the readable legacy value with `migration.status: "deferred"` and the underlying structured error.

## Integration Status
- Web and Steam factories expose the asynchronous service now.
- Gameplay settings and arcade history hydrate per user, retain revisions, recover conflicts once,
  and flush on suspend while preserving immediate offline legacy saves.
- Profile service behavior is unchanged; migration is available when the parent switches profile persistence to the new contract.
- A native Steam/console durable-storage adapter, cloud conflict policy, save-slot UI, and certification evidence remain open.

## Verification
Tests in `apps/game-web/src/platform/persistence.async.test.ts` and `persistence.shared.test.ts` cover:
- Web and Steam legacy behavior.
- User isolation.
- Revision conflicts and revision-checked deletion.
- Automatic settings/profile migration.
- Quota rejection and metadata.
- Interrupted-write recovery.
- Competing create serialization.
- Invalid JSON and unsupported scope behavior.
