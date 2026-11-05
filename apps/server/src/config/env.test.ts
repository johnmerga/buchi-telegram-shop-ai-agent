import { describe, expect, it } from 'vitest';
import { loadDatabaseUrl, loadEnv } from './env';

describe('loadEnv', () => {
  const required = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    TELEGRAM_BOT_TOKEN: '123:abc',
    TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
    JOB_SECRET: 'x'.repeat(32),
    AUTH_TOKEN_SECRET: 'y'.repeat(32),
    ORS_API_KEY: 'ors-key',
  };

  it('applies defaults', () => {
    expect(loadEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
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

  it('rejects a job secret shorter than 32 characters', () => {
    expect(() => loadEnv({ ...required, JOB_SECRET: 'x'.repeat(31) })).toThrow(/JOB_SECRET/);
  });

  it('rejects an auth token secret shorter than 32 characters', () => {
    expect(() => loadEnv({ ...required, AUTH_TOKEN_SECRET: 'y'.repeat(31) })).toThrow(
      /AUTH_TOKEN_SECRET/,
    );
  });
});

describe('loadDatabaseUrl', () => {
  it('needs only DATABASE_URL', () => {
    expect(loadDatabaseUrl({ DATABASE_URL: 'postgres://u:p@localhost:5432/db' })).toBe(
      'postgres://u:p@localhost:5432/db',
    );
  });
});
