import { describe, expect, it } from 'vitest';
import { loadDatabaseUrl, loadEnv } from './env';

const required = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  TELEGRAM_BOT_TOKEN: '123:abc',
  TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
  JOB_SECRET: 'x'.repeat(32),
  AUTH_TOKEN_SECRET: 'y'.repeat(32),
  GEMINI_API_KEY: 'gemini-key',
  RISK_HASH_SECRET: 'z'.repeat(32),
  ORS_API_KEY: 'ors-key',
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      PORT: 3000,
      TRUST_PROXY_HOPS: 0,
      LOG_LEVEL: 'info',
      GEMINI_MODEL_FAST: 'gemini-3.5-flash-lite',
      GEMINI_MODEL_SMART: 'gemini-3.5-flash',
      GEMINI_MODEL_EMBED: 'gemini-embedding-001',
      GEMINI_REQUESTS_PER_MINUTE: 10,
      GEMINI_REQUESTS_PER_DAY: 250,
      ORS_BASE_URL: 'https://api.heigit.org',
      NOMINATIM_USER_AGENT: 'Buchi/1.0 (contact via GitHub johnmerga/buchi-telegram-shop-ai-agent)',
    });
  });

  it('names a missing variable', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it('names an invalid variable', () => {
    expect(() => loadEnv({ ...required, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('reads the proxy hops in front of the server, and rejects a negative count', () => {
    expect(loadEnv({ ...required, TRUST_PROXY_HOPS: '2' }).TRUST_PROXY_HOPS).toBe(2);
    expect(() => loadEnv({ ...required, TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('rejects a job secret shorter than 32 characters', () => {
    expect(() => loadEnv({ ...required, JOB_SECRET: 'x'.repeat(31) })).toThrow(/JOB_SECRET/);
  });

  it('rejects an auth token secret shorter than 32 characters', () => {
    expect(() => loadEnv({ ...required, AUTH_TOKEN_SECRET: 'y'.repeat(31) })).toThrow(
      /AUTH_TOKEN_SECRET/,
    );
  });

  it('rejects a risk hash secret shorter than 32 characters', () => {
    expect(() => loadEnv({ ...required, RISK_HASH_SECRET: 'z'.repeat(31) })).toThrow(
      /RISK_HASH_SECRET/,
    );
  });
});

describe('Google service account', () => {
  it('restores the key’s line breaks from its one-line form', () => {
    const env = loadEnv({
      ...required,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: 'ledger@buchi.iam.gserviceaccount.com',
      GOOGLE_SERVICE_ACCOUNT_KEY:
        '-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n',
    });
    expect(env.GOOGLE_SERVICE_ACCOUNT_KEY).toBe(
      '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
    );
  });

  it('rejects an email without a key', () => {
    expect(() =>
      loadEnv({
        ...required,
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'ledger@buchi.iam.gserviceaccount.com',
      }),
    ).toThrow(/GOOGLE_SERVICE_ACCOUNT_KEY/);
  });
});

describe('loadDatabaseUrl', () => {
  it('needs only DATABASE_URL', () => {
    expect(loadDatabaseUrl({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' })).toBe(
      'postgres://u:p@localhost:5432/db',
    );
  });
});
