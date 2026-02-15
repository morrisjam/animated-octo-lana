# Arcade Run History

`S1.24` adds persisted arcade run summaries, best-time records, and profile sync.

## Stored summary fields

Each arcade run stores:

- player character id
- selected AI difficulty
- outcome (`completed` or `failed`)
- completion time (seconds)
- stage clear totals
- continues and retries used
- completion timestamp

Implementation:

- `apps/game-web/src/sim/arcadeHistory.ts`
- persisted local key: `gravity_well.arcade_history.v1`

## Best completion records

- Best records are computed per `(character, difficulty)` pair.
- Only completed clears contribute to best-time tables.
- Best-time view is shown in Local menu under `Arcade History`.

## Offline and sync behavior

- Runs are always appended to local history storage first.
- When account/profile services are available, local history is merged with profile history and synced back.
- Merge deduplicates by run id and keeps newest-first ordering.
