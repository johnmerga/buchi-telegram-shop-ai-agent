import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  const required = {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
    TELEGRAM_BOT_TOKEN: '123:abc',
    TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
    JOB_SECRET: 'x'.repeat(32),
  };

  it('applies defaults', () => {
    expect(loadEnv(required)).toEqual({
      ...required,
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
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
});
