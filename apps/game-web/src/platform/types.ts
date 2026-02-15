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
  signUp?(request: WebAuthSignupRequest): Promise<PlatformAuthSession>;
  signIn?(request: WebAuthSigninRequest): Promise<PlatformAuthSession>;
  signOut?(): Promise<PlatformAuthSession>;
}

export interface PlatformStorageService {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type PersistenceScope = 'local' | 'cloud';

export interface PersistenceReadSuccess<T> {
  ok: true;
  status: 'ok';
  value: T;
}

export interface PersistenceReadFailure {
  ok: false;
  status: 'not_found' | 'unsupported' | 'invalid_data' | 'error';
  reason: string;
}

export type PersistenceReadResult<T> = PersistenceReadSuccess<T> | PersistenceReadFailure;

export interface PersistenceWriteSuccess {
  ok: true;
  status: 'ok';
}

export interface PersistenceWriteFailure {
  ok: false;
  status: 'unsupported' | 'error';
  reason: string;
}

export type PersistenceWriteResult = PersistenceWriteSuccess | PersistenceWriteFailure;

export interface PlatformPersistenceService {
  isScopeSupported(scope: PersistenceScope): boolean;
  readJson<T>(key: string, options?: { scope?: PersistenceScope }): PersistenceReadResult<T>;
  writeJson(key: string, value: unknown, options?: { scope?: PersistenceScope }): PersistenceWriteResult;
  remove(key: string, options?: { scope?: PersistenceScope }): PersistenceWriteResult;
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
  persistence: PlatformPersistenceService;
  presence: PlatformPresenceService;
  profile: PlatformProfileService;
  dispose?(): void;
}
