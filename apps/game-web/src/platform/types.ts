export type PlatformKind = 'web' | 'steam';

export interface PlatformAuthSession {
  accountId: string | null;
  displayName: string | null;
  isAuthenticated: boolean;
}

export interface WebAuthSignupRequest {
  email: string;
  password: string;
  displayName?: string | null;
  upgradeCurrentGuest?: boolean;
}

export interface WebAuthSigninRequest {
  email: string;
  password: string;
}

export interface PlatformAuthService {
  getSession(): Promise<PlatformAuthSession>;
  getAccessToken?(): string | null;
  signUp?(request: WebAuthSignupRequest): Promise<PlatformAuthSession>;
  signIn?(request: WebAuthSigninRequest): Promise<PlatformAuthSession>;
  signOut?(): Promise<PlatformAuthSession>;
}

export interface PlatformStorageService {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  /** Checked variants let persistence report failures while legacy callers keep best-effort behavior. */
  setItemChecked?(key: string, value: string): void;
  removeItemChecked?(key: string): void;
  listKeys?(): string[];
}

export interface PlatformEntitlementAccess {
  allowed: boolean;
  status: 'granted' | 'denied' | 'unavailable';
  code: string;
  message: string;
}

export interface PlatformEntitlementService {
  checkAccess(context?: { stage?: 'startup' | 'session'; accountId?: string | null }): Promise<PlatformEntitlementAccess>;
}

export type PersistenceScope = 'local' | 'cloud';

export type PersistenceOperation = 'read' | 'write' | 'delete' | 'quota' | 'migrate';
export type PersistenceAtomicity = 'recoverable_replace' | 'platform_atomic';
export type PersistenceWriteIntent = 'atomic_replace';
export type PersistenceErrorCode =
  | 'invalid_argument'
  | 'not_found'
  | 'scope_unsupported'
  | 'invalid_data'
  | 'revision_conflict'
  | 'quota_exceeded'
  | 'storage_unavailable'
  | 'serialization_failed';

export interface PersistenceTarget {
  userId: string;
  scope?: PersistenceScope;
}

export interface PersistenceLegacySource {
  key: string;
  /** Keep legacy data by default while synchronous callers remain in production. */
  removeAfterMigration?: boolean;
}

export interface PersistenceReadOptions extends PersistenceTarget {
  legacySources?: readonly PersistenceLegacySource[];
}

export interface PersistenceWriteOptions extends PersistenceTarget {
  /** `null` means the caller expects the value not to exist. */
  expectedRevision?: string | null;
  intent?: PersistenceWriteIntent;
}

export interface PersistenceDeleteOptions extends PersistenceTarget {
  expectedRevision?: string | null;
}

export interface PersistenceQuotaOptions extends PersistenceTarget {}

export interface PersistenceQuotaSnapshot {
  scope: PersistenceScope;
  userId: string;
  userUsedBytes: number;
  platformUsedBytes: number | null;
  limitBytes: number | null;
  availableBytes: number | null;
  source: 'adapter' | 'estimated' | 'unknown';
}

export interface PersistenceMigrationMetadata {
  sourceKey: string;
  status: 'copied' | 'deferred';
  legacyRetained: boolean;
  error?: PersistenceErrorMetadata;
}

export interface PersistenceResultMetadata {
  key: string;
  userId: string;
  scope: PersistenceScope;
  storageKey: string;
  revision: string | null;
  bytes: number;
  updatedAt: string | null;
  atomicity?: PersistenceAtomicity;
  writeIntent?: PersistenceWriteIntent;
  migration?: PersistenceMigrationMetadata;
}

export interface PersistenceErrorMetadata {
  code: PersistenceErrorCode;
  message: string;
  retryable: boolean;
  operation: PersistenceOperation;
  key: string;
  userId: string;
  scope: PersistenceScope;
  expectedRevision?: string | null;
  actualRevision?: string | null;
  quota?: PersistenceQuotaSnapshot;
  causeName?: string;
}

export interface PersistenceReadSuccess<T> {
  ok: true;
  status: 'ok';
  value: T;
  metadata: PersistenceResultMetadata;
}

export interface PersistenceReadFailure {
  ok: false;
  status: 'not_found' | 'unsupported' | 'invalid_data' | 'conflict' | 'quota_exceeded' | 'error';
  reason: string;
  error: PersistenceErrorMetadata;
}

export type PersistenceReadResult<T> = PersistenceReadSuccess<T> | PersistenceReadFailure;

export interface PersistenceWriteSuccess {
  ok: true;
  status: 'ok';
  metadata: PersistenceResultMetadata;
}

export interface PersistenceWriteFailure {
  ok: false;
  status: 'unsupported' | 'conflict' | 'quota_exceeded' | 'error';
  reason: string;
  error: PersistenceErrorMetadata;
}

export type PersistenceWriteResult = PersistenceWriteSuccess | PersistenceWriteFailure;

export interface PersistenceQuotaSuccess {
  ok: true;
  status: 'ok';
  quota: PersistenceQuotaSnapshot;
}

export interface PersistenceQuotaFailure {
  ok: false;
  status: 'unsupported' | 'error';
  reason: string;
  error: PersistenceErrorMetadata;
}

export type PersistenceQuotaResult = PersistenceQuotaSuccess | PersistenceQuotaFailure;

export interface LegacyPersistenceReadSuccess<T> {
  ok: true;
  status: 'ok';
  value: T;
}

export interface LegacyPersistenceReadFailure {
  ok: false;
  status: 'not_found' | 'unsupported' | 'invalid_data' | 'error';
  reason: string;
}

export type LegacyPersistenceReadResult<T> = LegacyPersistenceReadSuccess<T> | LegacyPersistenceReadFailure;

export interface LegacyPersistenceWriteSuccess {
  ok: true;
  status: 'ok';
}

export interface LegacyPersistenceWriteFailure {
  ok: false;
  status: 'unsupported' | 'error';
  reason: string;
}

export type LegacyPersistenceWriteResult = LegacyPersistenceWriteSuccess | LegacyPersistenceWriteFailure;

export interface PlatformPersistenceService {
  isScopeSupported(scope: PersistenceScope): boolean;
  read<T>(key: string, options: PersistenceReadOptions): Promise<PersistenceReadResult<T>>;
  write(key: string, value: unknown, options: PersistenceWriteOptions): Promise<PersistenceWriteResult>;
  delete(key: string, options: PersistenceDeleteOptions): Promise<PersistenceWriteResult>;
  getQuota(options: PersistenceQuotaOptions): Promise<PersistenceQuotaResult>;
  /** @deprecated Use the asynchronous, user-scoped `read` method. */
  readJson<T>(key: string, options?: { scope?: PersistenceScope }): LegacyPersistenceReadResult<T>;
  /** @deprecated Use the asynchronous, user-scoped `write` method. */
  writeJson(key: string, value: unknown, options?: { scope?: PersistenceScope }): LegacyPersistenceWriteResult;
  /** @deprecated Use the asynchronous, user-scoped `delete` method. */
  remove(key: string, options?: { scope?: PersistenceScope }): LegacyPersistenceWriteResult;
}

export type PlatformLifecycleStatus = 'active' | 'suspended';
export type PlatformSuspendReason = 'visibility_hidden' | 'page_hidden' | 'platform';
export type PlatformResumeReason = 'visibility_visible' | 'page_shown' | 'platform';

interface PlatformLifecycleEventBase {
  occurredAt: string;
  sequence: number;
}

export interface PlatformSuspendEvent extends PlatformLifecycleEventBase {
  type: 'suspend';
  reason: PlatformSuspendReason;
}

export interface PlatformResumeEvent extends PlatformLifecycleEventBase {
  type: 'resume';
  reason: PlatformResumeReason;
}

export interface PlatformUserChangeEvent extends PlatformLifecycleEventBase {
  type: 'user_change';
  previousUserId: string | null;
  currentUserId: string | null;
}

export interface PlatformEntitlementChangeEvent extends PlatformLifecycleEventBase {
  type: 'entitlement_change';
  accountId: string | null;
  previous: PlatformEntitlementAccess | null;
  current: PlatformEntitlementAccess;
}

export interface PlatformControllerDisconnectEvent extends PlatformLifecycleEventBase {
  type: 'controller_disconnect';
  controllerIndex: number;
  controllerId: string;
  userId: string | null;
}

export type PlatformLifecycleEvent =
  | PlatformSuspendEvent
  | PlatformResumeEvent
  | PlatformUserChangeEvent
  | PlatformEntitlementChangeEvent
  | PlatformControllerDisconnectEvent;

export interface PlatformLifecycleState {
  status: PlatformLifecycleStatus;
  activeUserId: string | null;
  entitlementAccountId: string | null;
  entitlement: PlatformEntitlementAccess | null;
  sequence: number;
  lastEvent: PlatformLifecycleEvent | null;
}

export type PlatformLifecycleListener = (event: PlatformLifecycleEvent, state: PlatformLifecycleState) => void;

export interface PlatformLifecycleService {
  getState(): PlatformLifecycleState;
  subscribe(listener: PlatformLifecycleListener): () => void;
}

export interface PlatformLifecycleHooks {
  suspend(reason?: PlatformSuspendReason): void;
  resume(reason?: PlatformResumeReason): void;
  userChanged(currentUserId: string | null): void;
  entitlementChanged(accountId: string | null, access: PlatformEntitlementAccess): void;
  controllerDisconnected(controllerIndex: number, controllerId: string, userId?: string | null): void;
}

export interface PlatformPresenceService {
  setStatus(status: string): Promise<void>;
  getStatus(): string | null;
}

export interface PlayerProfile {
  accountId: string;
  displayName: string | null;
  settings: Record<string, unknown>;
  updatedAt: string | null;
  source: 'remote' | 'cache' | 'default';
}

export interface PlatformProfileService {
  getProfile(accountId: string): Promise<PlayerProfile>;
  saveProfile(
    accountId: string,
    payload: { displayName?: string | null; settings?: Record<string, unknown> },
  ): Promise<PlayerProfile>;
}

export interface PlatformServices {
  kind: PlatformKind;
  auth: PlatformAuthService;
  storage: PlatformStorageService;
  entitlement: PlatformEntitlementService;
  persistence: PlatformPersistenceService;
  lifecycle: PlatformLifecycleService;
  lifecycleHooks: PlatformLifecycleHooks;
  presence: PlatformPresenceService;
  profile: PlatformProfileService;
  dispose?(): void;
}
