import type {
  LegacyPersistenceReadResult,
  LegacyPersistenceWriteResult,
  PersistenceAtomicity,
  PersistenceDeleteOptions,
  PersistenceErrorCode,
  PersistenceErrorMetadata,
  PersistenceOperation,
  PersistenceQuotaResult,
  PersistenceQuotaSnapshot,
  PersistenceReadFailure,
  PersistenceReadOptions,
  PersistenceReadResult,
  PersistenceResultMetadata,
  PersistenceScope,
  PersistenceWriteFailure,
  PersistenceWriteOptions,
  PersistenceWriteResult,
  PlatformPersistenceService,
  PlatformStorageService,
} from './types';

const DEFAULT_SCOPE: PersistenceScope = 'local';
const DEFAULT_NAMESPACE = 'gravity_well.persistence.v2';
const ENVELOPE_SCHEMA = 'gw.persistence.envelope.v2';
const WRITE_INTENT_SCHEMA = 'gw.persistence.write-intent.v1';

interface PersistenceEnvelope {
  schemaVersion: typeof ENVELOPE_SCHEMA;
  key: string;
  userId: string;
  scope: PersistenceScope;
  revision: string;
  updatedAt: string;
  value: unknown;
}

interface PersistenceWriteIntentEnvelope {
  schemaVersion: typeof WRITE_INTENT_SCHEMA;
  targetKey: string;
  envelope: string;
}

export interface PersistenceQuotaEstimate {
  usedBytes?: number | null;
  limitBytes?: number | null;
}

export interface StorageBackedPersistenceOptions {
  supportedScopes?: readonly PersistenceScope[];
  namespace?: string;
  quotaProvider?: () => Promise<PersistenceQuotaEstimate>;
  legacySourceResolver?: (
    key: string,
    userId: string,
  ) => PersistenceReadOptions['legacySources'];
  now?: () => Date;
  createRevision?: () => string;
}

interface OperationContext {
  key: string;
  userId: string;
  scope: PersistenceScope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function entryByteLength(key: string, value: string): number {
  return byteLength(key) + byteLength(value);
}

function encodeStorageComponent(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function resolveScope(options?: { scope?: PersistenceScope }): PersistenceScope {
  return options?.scope ?? DEFAULT_SCOPE;
}

function causeName(error: unknown): string | undefined {
  if (error instanceof Error && error.name) {
    return error.name;
  }
  return undefined;
}

function isQuotaError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'QuotaExceededError'
    || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || /quota/i.test(error.message);
}

function parseEnvelope(raw: string, context: OperationContext): PersistenceEnvelope | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value)
      || value.schemaVersion !== ENVELOPE_SCHEMA
      || value.key !== context.key
      || value.userId !== context.userId
      || value.scope !== context.scope
      || typeof value.revision !== 'string'
      || typeof value.updatedAt !== 'string'
      || !('value' in value)
    ) {
      return null;
    }
    return value as unknown as PersistenceEnvelope;
  } catch {
    return null;
  }
}

function parseWriteIntent(raw: string, targetKey: string): PersistenceWriteIntentEnvelope | null {
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value)
      || value.schemaVersion !== WRITE_INTENT_SCHEMA
      || value.targetKey !== targetKey
      || typeof value.envelope !== 'string'
    ) {
      return null;
    }
    return value as unknown as PersistenceWriteIntentEnvelope;
  } catch {
    return null;
  }
}

export function createStorageBackedPersistenceService(
  storage: PlatformStorageService,
  options: StorageBackedPersistenceOptions = {},
): PlatformPersistenceService {
  const supportedScopeSet = new Set<PersistenceScope>(options.supportedScopes ?? ['local']);
  const namespace = options.namespace?.trim() || DEFAULT_NAMESPACE;
  const now = options.now ?? (() => new Date());
  let revisionCounter = 0;
  const createRevision = options.createRevision ?? (() => {
    revisionCounter += 1;
    return `${now().getTime().toString(36)}-${revisionCounter.toString(36)}`;
  });
  const queues = new Map<string, Promise<void>>();

  function checkedSetItem(key: string, value: string): void {
    if (storage.setItemChecked) {
      storage.setItemChecked(key, value);
      return;
    }
    storage.setItem(key, value);
  }

  function checkedRemoveItem(key: string): void {
    if (storage.removeItemChecked) {
      storage.removeItemChecked(key);
      return;
    }
    storage.removeItem(key);
  }

  function isScopeSupported(scope: PersistenceScope): boolean {
    return supportedScopeSet.has(scope);
  }

  function validateContext(key: string, userId: string, scope: PersistenceScope): string | null {
    if (!key.trim()) {
      return 'Persistence key must not be empty.';
    }
    if (!userId.trim()) {
      return 'Persistence userId must not be empty.';
    }
    if (userId !== userId.trim()) {
      return 'Persistence userId must not contain leading or trailing whitespace.';
    }
    if (!isScopeSupported(scope)) {
      return 'Persistence scope is not supported on this platform.';
    }
    return null;
  }

  function userPrefix(userId: string, scope: PersistenceScope): string {
    return `${namespace}.${scope}.user.${encodeStorageComponent(userId)}.`;
  }

  function storageKeyFor(context: OperationContext): string {
    return `${userPrefix(context.userId, context.scope)}${encodeStorageComponent(context.key)}`;
  }

  function intentKeyFor(storageKey: string): string {
    return `${namespace}.intent.${encodeStorageComponent(storageKey)}`;
  }

  function errorMetadata(
    context: OperationContext,
    operation: PersistenceOperation,
    code: PersistenceErrorCode,
    message: string,
    retryable: boolean,
    extra: Partial<PersistenceErrorMetadata> = {},
  ): PersistenceErrorMetadata {
    return {
      code,
      message,
      retryable,
      operation,
      key: context.key,
      userId: context.userId,
      scope: context.scope,
      ...extra,
    };
  }

  function readFailure(
    context: OperationContext,
    status: PersistenceReadFailure['status'],
    code: PersistenceErrorCode,
    message: string,
    retryable = false,
    extra: Partial<PersistenceErrorMetadata> = {},
  ): PersistenceReadFailure {
    return {
      ok: false,
      status,
      reason: message,
      error: errorMetadata(context, 'read', code, message, retryable, extra),
    };
  }

  function writeFailure(
    context: OperationContext,
    operation: 'write' | 'delete' | 'migrate',
    status: PersistenceWriteFailure['status'],
    code: PersistenceErrorCode,
    message: string,
    retryable = false,
    extra: Partial<PersistenceErrorMetadata> = {},
  ): PersistenceWriteFailure {
    return {
      ok: false,
      status,
      reason: message,
      error: errorMetadata(context, operation, code, message, retryable, extra),
    };
  }

  function resultMetadata(
    context: OperationContext,
    storageKey: string,
    envelope: PersistenceEnvelope | null,
    bytes: number,
    atomicity?: PersistenceAtomicity,
  ): PersistenceResultMetadata {
    return {
      key: context.key,
      userId: context.userId,
      scope: context.scope,
      storageKey,
      revision: envelope?.revision ?? null,
      bytes,
      updatedAt: envelope?.updatedAt ?? null,
      ...(atomicity ? { atomicity, writeIntent: 'atomic_replace' as const } : {}),
    };
  }

  async function enqueue<T>(storageKey: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(storageKey) ?? Promise.resolve();
    const run = previous.then(operation, operation);
    const tail = run.then(() => undefined, () => undefined);
    queues.set(storageKey, tail);
    try {
      return await run;
    } finally {
      if (queues.get(storageKey) === tail) {
        queues.delete(storageKey);
      }
    }
  }

  function recoverInterruptedWrite(storageKey: string, context: OperationContext): string | null {
    const intentKey = intentKeyFor(storageKey);
    const intentRaw = storage.getItem(intentKey);
    if (intentRaw === null) {
      return storage.getItem(storageKey);
    }

    const intent = parseWriteIntent(intentRaw, storageKey);
    if (!intent || !parseEnvelope(intent.envelope, context)) {
      checkedRemoveItem(intentKey);
      return storage.getItem(storageKey);
    }

    if (storage.getItem(storageKey) !== intent.envelope) {
      checkedSetItem(storageKey, intent.envelope);
    }
    checkedRemoveItem(intentKey);
    return intent.envelope;
  }

  async function quotaSnapshot(userId: string, scope: PersistenceScope): Promise<PersistenceQuotaSnapshot> {
    let userUsedBytes = 0;
    let enumeratedPlatformBytes: number | null = null;
    if (storage.listKeys) {
      enumeratedPlatformBytes = 0;
      const prefix = userPrefix(userId, scope);
      for (const key of storage.listKeys()) {
        const value = storage.getItem(key);
        if (value === null) {
          continue;
        }
        const bytes = entryByteLength(key, value);
        enumeratedPlatformBytes += bytes;
        if (key.startsWith(prefix)) {
          userUsedBytes += bytes;
        }
      }
    }

    let adapterEstimate: PersistenceQuotaEstimate | null = null;
    if (options.quotaProvider) {
      try {
        adapterEstimate = await options.quotaProvider();
      } catch {
        adapterEstimate = null;
      }
    }
    const platformUsedBytes = adapterEstimate?.usedBytes ?? enumeratedPlatformBytes;
    const limitBytes = adapterEstimate?.limitBytes ?? null;
    const hasAdapterEstimate = adapterEstimate?.usedBytes != null || adapterEstimate?.limitBytes != null;
    const availableBytes = limitBytes === null || platformUsedBytes === null
      ? null
      : Math.max(0, limitBytes - platformUsedBytes);
    return {
      scope,
      userId,
      userUsedBytes,
      platformUsedBytes,
      limitBytes,
      availableBytes,
      source: hasAdapterEstimate ? 'adapter' : enumeratedPlatformBytes === null ? 'unknown' : 'estimated',
    };
  }

  async function performWrite(
    context: OperationContext,
    storageKey: string,
    value: unknown,
    writeOptions: PersistenceWriteOptions,
    operation: 'write' | 'migrate' = 'write',
  ): Promise<PersistenceWriteResult> {
    let currentRaw: string | null;
    try {
      currentRaw = recoverInterruptedWrite(storageKey, context);
    } catch (error) {
      const quota = await quotaSnapshot(context.userId, context.scope);
      return writeFailure(
        context,
        operation,
        isQuotaError(error) ? 'quota_exceeded' : 'error',
        isQuotaError(error) ? 'quota_exceeded' : 'storage_unavailable',
        isQuotaError(error) ? 'Persistence quota was exceeded while recovering a write.' : 'Persistence storage is unavailable.',
        true,
        { causeName: causeName(error), quota },
      );
    }
    const currentEnvelope = currentRaw === null ? null : parseEnvelope(currentRaw, context);
    if (currentRaw !== null && !currentEnvelope) {
      return writeFailure(
        context,
        operation,
        'error',
        'invalid_data',
        'Existing scoped persistence data is invalid and was not overwritten.',
      );
    }

    const actualRevision = currentEnvelope?.revision ?? null;
    if (writeOptions.expectedRevision !== undefined && writeOptions.expectedRevision !== actualRevision) {
      return writeFailure(
        context,
        operation,
        'conflict',
        'revision_conflict',
        'Persisted data changed after it was read.',
        true,
        {
          expectedRevision: writeOptions.expectedRevision,
          actualRevision,
        },
      );
    }

    const envelope: PersistenceEnvelope = {
      schemaVersion: ENVELOPE_SCHEMA,
      key: context.key,
      userId: context.userId,
      scope: context.scope,
      revision: createRevision(),
      updatedAt: now().toISOString(),
      value,
    };
    let serialisedEnvelope: string;
    try {
      const serialised = JSON.stringify(envelope);
      if (serialised === undefined) {
        throw new TypeError('Value cannot be represented as JSON.');
      }
      serialisedEnvelope = serialised;
    } catch (error) {
      return writeFailure(
        context,
        operation,
        'error',
        'serialization_failed',
        'Persistence value could not be serialised.',
        false,
        { causeName: causeName(error) },
      );
    }

    const intentKey = intentKeyFor(storageKey);
    const serialisedIntent = JSON.stringify({
      schemaVersion: WRITE_INTENT_SCHEMA,
      targetKey: storageKey,
      envelope: serialisedEnvelope,
    } satisfies PersistenceWriteIntentEnvelope);
    const quota = await quotaSnapshot(context.userId, context.scope);
    if (quota.limitBytes !== null && quota.platformUsedBytes !== null) {
      const previousBytes = currentRaw === null ? 0 : entryByteLength(storageKey, currentRaw);
      const nextBytes = entryByteLength(storageKey, serialisedEnvelope);
      const intentBytes = entryByteLength(intentKey, serialisedIntent);
      const peakBytes = quota.platformUsedBytes + intentBytes + Math.max(0, nextBytes - previousBytes);
      if (peakBytes > quota.limitBytes) {
        return writeFailure(
          context,
          operation,
          'quota_exceeded',
          'quota_exceeded',
          'Persistence write would exceed the platform storage quota.',
          false,
          { quota },
        );
      }
    }

    try {
      checkedSetItem(intentKey, serialisedIntent);
      checkedSetItem(storageKey, serialisedEnvelope);
      checkedRemoveItem(intentKey);
    } catch (error) {
      try {
        checkedRemoveItem(intentKey);
      } catch {
        // A later read will either finish or discard the recoverable intent.
      }
      const latestQuota = await quotaSnapshot(context.userId, context.scope);
      return writeFailure(
        context,
        operation,
        isQuotaError(error) ? 'quota_exceeded' : 'error',
        isQuotaError(error) ? 'quota_exceeded' : 'storage_unavailable',
        isQuotaError(error) ? 'Persistence quota was exceeded.' : 'Persistence write failed.',
        true,
        { causeName: causeName(error), quota: latestQuota },
      );
    }

    return {
      ok: true,
      status: 'ok',
      metadata: resultMetadata(
        context,
        storageKey,
        envelope,
        byteLength(serialisedEnvelope),
        'recoverable_replace',
      ),
    };
  }

  async function performRead<T>(
    context: OperationContext,
    storageKey: string,
    readOptions: PersistenceReadOptions,
  ): Promise<PersistenceReadResult<T>> {
    let raw: string | null;
    try {
      raw = recoverInterruptedWrite(storageKey, context);
    } catch (error) {
      return readFailure(
        context,
        isQuotaError(error) ? 'quota_exceeded' : 'error',
        isQuotaError(error) ? 'quota_exceeded' : 'storage_unavailable',
        isQuotaError(error) ? 'Persistence quota was exceeded while recovering a write.' : 'Persistence storage is unavailable.',
        true,
        { causeName: causeName(error), quota: await quotaSnapshot(context.userId, context.scope) },
      );
    }

    if (raw !== null) {
      const envelope = parseEnvelope(raw, context);
      if (!envelope) {
        return readFailure(
          context,
          'invalid_data',
          'invalid_data',
          'Persisted value has an invalid or mismatched envelope.',
        );
      }
      return {
        ok: true,
        status: 'ok',
        value: envelope.value as T,
        metadata: resultMetadata(context, storageKey, envelope, byteLength(raw)),
      };
    }

    const legacySources = readOptions.legacySources
      ?? options.legacySourceResolver?.(context.key, context.userId)
      ?? [];
    for (const source of legacySources) {
      const legacyRaw = storage.getItem(source.key);
      if (legacyRaw === null) {
        continue;
      }
      let legacyValue: T;
      try {
        legacyValue = JSON.parse(legacyRaw) as T;
      } catch {
        return readFailure(
          context,
          'invalid_data',
          'invalid_data',
          `Legacy persistence value at "${source.key}" is not valid JSON.`,
        );
      }

      const migrated = await performWrite(
        context,
        storageKey,
        legacyValue,
        { ...readOptions, expectedRevision: null, intent: 'atomic_replace' },
        'migrate',
      );
      if (migrated.ok === false) {
        return {
          ok: true,
          status: 'ok',
          value: legacyValue,
          metadata: {
            ...resultMetadata(context, storageKey, null, byteLength(legacyRaw)),
            migration: {
              sourceKey: source.key,
              status: 'deferred',
              legacyRetained: true,
              error: migrated.error,
            },
          },
        };
      }

      let legacyRetained = true;
      if (source.removeAfterMigration) {
        try {
          checkedRemoveItem(source.key);
          legacyRetained = false;
        } catch {
          legacyRetained = true;
        }
      }
      return {
        ok: true,
        status: 'ok',
        value: legacyValue,
        metadata: {
          ...migrated.metadata,
          migration: {
            sourceKey: source.key,
            status: 'copied',
            legacyRetained,
          },
        },
      };
    }

    return readFailure(context, 'not_found', 'not_found', 'No persisted value exists for this key.');
  }

  function unsupportedLegacyWrite(): LegacyPersistenceWriteResult {
    return {
      ok: false,
      status: 'unsupported',
      reason: 'Persistence scope is not supported on this platform.',
    };
  }

  return {
    isScopeSupported,
    async read<T>(key: string, readOptions: PersistenceReadOptions): Promise<PersistenceReadResult<T>> {
      const scope = resolveScope(readOptions);
      const context = { key, userId: readOptions.userId, scope };
      const validationError = validateContext(key, readOptions.userId, scope);
      if (validationError) {
        return readFailure(
          context,
          isScopeSupported(scope) ? 'error' : 'unsupported',
          isScopeSupported(scope) ? 'invalid_argument' : 'scope_unsupported',
          validationError,
        );
      }
      const storageKey = storageKeyFor(context);
      return await enqueue(storageKey, () => performRead<T>(context, storageKey, readOptions));
    },
    async write(key: string, value: unknown, writeOptions: PersistenceWriteOptions): Promise<PersistenceWriteResult> {
      const scope = resolveScope(writeOptions);
      const context = { key, userId: writeOptions.userId, scope };
      const validationError = validateContext(key, writeOptions.userId, scope);
      if (validationError) {
        return writeFailure(
          context,
          'write',
          isScopeSupported(scope) ? 'error' : 'unsupported',
          isScopeSupported(scope) ? 'invalid_argument' : 'scope_unsupported',
          validationError,
        );
      }
      if (writeOptions.intent !== undefined && writeOptions.intent !== 'atomic_replace') {
        return writeFailure(
          context,
          'write',
          'error',
          'invalid_argument',
          'Unsupported persistence write intent.',
        );
      }
      const storageKey = storageKeyFor(context);
      return await enqueue(storageKey, () => performWrite(context, storageKey, value, writeOptions));
    },
    async delete(key: string, deleteOptions: PersistenceDeleteOptions): Promise<PersistenceWriteResult> {
      const scope = resolveScope(deleteOptions);
      const context = { key, userId: deleteOptions.userId, scope };
      const validationError = validateContext(key, deleteOptions.userId, scope);
      if (validationError) {
        return writeFailure(
          context,
          'delete',
          isScopeSupported(scope) ? 'error' : 'unsupported',
          isScopeSupported(scope) ? 'invalid_argument' : 'scope_unsupported',
          validationError,
        );
      }
      const storageKey = storageKeyFor(context);
      return await enqueue(storageKey, async () => {
        let raw: string | null;
        try {
          raw = recoverInterruptedWrite(storageKey, context);
        } catch (error) {
          return writeFailure(
            context,
            'delete',
            'error',
            'storage_unavailable',
            'Persistence delete failed while recovering a write.',
            true,
            { causeName: causeName(error) },
          );
        }
        const envelope = raw === null ? null : parseEnvelope(raw, context);
        if (raw !== null && !envelope) {
          return writeFailure(
            context,
            'delete',
            'error',
            'invalid_data',
            'Existing scoped persistence data is invalid and was not deleted.',
          );
        }
        const actualRevision = envelope?.revision ?? null;
        if (deleteOptions.expectedRevision !== undefined && deleteOptions.expectedRevision !== actualRevision) {
          return writeFailure(
            context,
            'delete',
            'conflict',
            'revision_conflict',
            'Persisted data changed after it was read.',
            true,
            { expectedRevision: deleteOptions.expectedRevision, actualRevision },
          );
        }
        try {
          checkedRemoveItem(storageKey);
          checkedRemoveItem(intentKeyFor(storageKey));
        } catch (error) {
          return writeFailure(
            context,
            'delete',
            'error',
            'storage_unavailable',
            'Persistence delete failed.',
            true,
            { causeName: causeName(error) },
          );
        }
        return {
          ok: true,
          status: 'ok',
          metadata: resultMetadata(context, storageKey, envelope, raw === null ? 0 : byteLength(raw)),
        };
      });
    },
    async getQuota(quotaOptions): Promise<PersistenceQuotaResult> {
      const scope = resolveScope(quotaOptions);
      const context = { key: '', userId: quotaOptions.userId, scope };
      const validationError = validateContext('quota', quotaOptions.userId, scope);
      if (validationError) {
        const status = isScopeSupported(scope) ? 'error' as const : 'unsupported' as const;
        const code = isScopeSupported(scope) ? 'invalid_argument' as const : 'scope_unsupported' as const;
        return {
          ok: false,
          status,
          reason: validationError,
          error: errorMetadata(context, 'quota', code, validationError, false),
        };
      }
      try {
        return {
          ok: true,
          status: 'ok',
          quota: await quotaSnapshot(quotaOptions.userId, scope),
        };
      } catch (error) {
        const message = 'Persistence quota could not be inspected.';
        return {
          ok: false,
          status: 'error',
          reason: message,
          error: errorMetadata(
            context,
            'quota',
            'storage_unavailable',
            message,
            true,
            { causeName: causeName(error) },
          ),
        };
      }
    },
    readJson<T>(key: string, legacyOptions?: { scope?: PersistenceScope }): LegacyPersistenceReadResult<T> {
      const scope = resolveScope(legacyOptions);
      if (!isScopeSupported(scope)) {
        return {
          ok: false,
          status: 'unsupported',
          reason: 'Persistence scope is not supported on this platform.',
        };
      }
      const raw = storage.getItem(key);
      if (raw === null) {
        return {
          ok: false,
          status: 'not_found',
          reason: 'No persisted value exists for this key.',
        };
      }
      try {
        return { ok: true, status: 'ok', value: JSON.parse(raw) as T };
      } catch {
        return {
          ok: false,
          status: 'invalid_data',
          reason: 'Persisted value is not valid JSON.',
        };
      }
    },
    writeJson(key: string, value: unknown, legacyOptions?: { scope?: PersistenceScope }): LegacyPersistenceWriteResult {
      const scope = resolveScope(legacyOptions);
      if (!isScopeSupported(scope)) {
        return unsupportedLegacyWrite();
      }
      try {
        storage.setItem(key, JSON.stringify(value));
        return { ok: true, status: 'ok' };
      } catch {
        return { ok: false, status: 'error', reason: 'Failed to write persisted value.' };
      }
    },
    remove(key: string, legacyOptions?: { scope?: PersistenceScope }): LegacyPersistenceWriteResult {
      const scope = resolveScope(legacyOptions);
      if (!isScopeSupported(scope)) {
        return unsupportedLegacyWrite();
      }
      try {
        storage.removeItem(key);
        return { ok: true, status: 'ok' };
      } catch {
        return { ok: false, status: 'error', reason: 'Failed to remove persisted value.' };
      }
    },
  };
}

export const PLATFORM_PERSISTENCE_ENVELOPE_SCHEMA = ENVELOPE_SCHEMA;
export const PLATFORM_PERSISTENCE_WRITE_INTENT_SCHEMA = WRITE_INTENT_SCHEMA;
export const PLATFORM_PERSISTENCE_KEYS = {
  settings: 'settings',
  profile: 'profile',
} as const;
