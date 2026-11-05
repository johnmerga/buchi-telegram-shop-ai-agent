import { describe, expect, it } from 'vitest';
import { launchFields, signInitData } from '../../../test/sign-init-data';
import { AppError } from '../../shared/errors';
import { verifyInitData } from './init-data.domain';

const botToken = '123456:test-bot-token';
const now = new Date('2026-11-05T12:00:00Z');

function verify(initData: string): number {
  return verifyInitData(initData, botToken, now);
}

function expectUnauthorized(initData: string, message: RegExp): void {
  let rejection: unknown;
  try {
    verify(initData);
  } catch (err) {
    rejection = err;
  }
  expect(rejection).toBeInstanceOf(AppError);
  expect(rejection).toHaveProperty('code', 'UNAUTHORIZED');
  expect(rejection).toHaveProperty('message', expect.stringMatching(message));
}

describe('verifyInitData', () => {
  it('returns the Telegram user ID of valid launch data', () => {
    expect(verify(signInitData(launchFields(42, now), botToken))).toBe(42);
  });

  it('sorts fields by key, not by the joined key=value text', () => {
    const fields = { ...launchFields(42, now), a: 'x', a1: 'y' };
    expect(verify(signInitData(fields, botToken))).toBe(42);
  });

  it('accepts data signed exactly 24 hours ago', () => {
    expect(verify(signInitData(launchFields(42, now, 24 * 60 * 60), botToken))).toBe(42);
  });

  it('rejects a field changed after signing', () => {
    const params = new URLSearchParams(signInitData(launchFields(42, now), botToken));
    params.set('user', JSON.stringify({ id: 7, first_name: 'Mallory' }));
    expectUnauthorized(params.toString(), /signature/);
  });

  it('rejects a changed signature field, because it is part of the signed data', () => {
    const params = new URLSearchParams(signInitData(launchFields(42, now), botToken));
    params.set('signature', 'forged');
    expectUnauthorized(params.toString(), /signature/);
  });

  it('rejects data signed with another bot token', () => {
    expectUnauthorized(signInitData(launchFields(42, now), '999:other-token'), /signature/);
  });

  it('rejects a wrong hash', () => {
    const params = new URLSearchParams(signInitData(launchFields(42, now), botToken));
    params.set('hash', '0'.repeat(64));
    expectUnauthorized(params.toString(), /signature/);
  });

  it('rejects data without a hash', () => {
    expectUnauthorized(new URLSearchParams(launchFields(42, now)).toString(), /hash/);
  });

  it('rejects a hash that is not 64 hex characters', () => {
    const params = new URLSearchParams(signInitData(launchFields(42, now), botToken));
    params.set('hash', 'not-hex');
    expectUnauthorized(params.toString(), /hash/);
  });

  it('rejects data older than 24 hours', () => {
    expectUnauthorized(signInitData(launchFields(42, now, 24 * 60 * 60 + 1), botToken), /expired/);
  });

  it('rejects signed data without auth_date', () => {
    const fields = launchFields(42, now);
    delete fields.auth_date;
    expectUnauthorized(signInitData(fields, botToken), /auth_date/);
  });

  it('rejects signed data without a user', () => {
    const fields = launchFields(42, now);
    delete fields.user;
    expectUnauthorized(signInitData(fields, botToken), /user/);
  });

  it('rejects a user that is not JSON', () => {
    const fields = { ...launchFields(42, now), user: '{not json' };
    expectUnauthorized(signInitData(fields, botToken), /user/);
  });

  it('rejects a user without a numeric ID', () => {
    const fields = { ...launchFields(42, now), user: JSON.stringify({ id: '42' }) };
    expectUnauthorized(signInitData(fields, botToken), /user/);
  });
});
