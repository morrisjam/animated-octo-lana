import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export const WEB_PASSWORD_MIN_LENGTH = 8;
export const WEB_PASSWORD_MAX_LENGTH = 128;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface PasswordHashRecord {
  hash: string;
  salt: string;
}

export function normaliseWebEmail(rawEmail: unknown): string | null {
  if (typeof rawEmail !== 'string') {
    return null;
  }
  const email = rawEmail.trim().toLowerCase();
  if (!email || email.length > 320 || !EMAIL_REGEX.test(email)) {
    return null;
  }
  return email;
}

export function validateWebPassword(rawPassword: unknown): { ok: true } | { ok: false; error: string } {
  if (typeof rawPassword !== 'string') {
    return { ok: false, error: 'password is required.' };
  }
  if (rawPassword.length < WEB_PASSWORD_MIN_LENGTH || rawPassword.length > WEB_PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      error: `password must be between ${WEB_PASSWORD_MIN_LENGTH} and ${WEB_PASSWORD_MAX_LENGTH} characters.`,
    };
  }
  return { ok: true };
}

export async function hashWebPassword(password: string): Promise<PasswordHashRecord> {
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64) as Buffer;
  return {
    hash: derived.toString('hex'),
    salt,
  };
}

export async function verifyWebPassword(password: string, record: PasswordHashRecord): Promise<boolean> {
  if (!record.hash || !record.salt) {
    return false;
  }
  const expected = Buffer.from(record.hash, 'hex');
  if (expected.length === 0) {
    return false;
  }
  const actual = await scrypt(password, record.salt, expected.length) as Buffer;
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}
