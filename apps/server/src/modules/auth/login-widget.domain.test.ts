import { describe, expect, it } from 'vitest';
import { signLoginWidget } from '../../../test/sign-login-widget';
import { verifyLoginWidget } from './login-widget.domain';

const botToken = '123456:test-bot-token';
const now = new Date('2026-11-05T12:00:00Z');
const authDate = Math.floor(now.getTime() / 1000) - 60;
const fields = { id: 42, first_name: 'Selam', username: 'selam', auth_date: authDate };

describe('verifyLoginWidget', () => {
  it('returns the user ID of correctly signed data', () => {
    expect(verifyLoginWidget(signLoginWidget(fields, botToken), botToken, now)).toBe(42);
  });

  it('accepts fields that Telegram sends as strings', () => {
    const data = signLoginWidget({ ...fields, id: '42', auth_date: String(authDate) }, botToken);
    expect(verifyLoginWidget(data, botToken, now)).toBe(42);
  });

  it('rejects a changed user ID', () => {
    const data = { ...signLoginWidget(fields, botToken), id: 43 };
    expect(() => verifyLoginWidget(data, botToken, now)).toThrow('signature does not match');
  });

  it('rejects an added field that was not signed', () => {
    const data = { ...signLoginWidget(fields, botToken), last_name: 'Bekele' };
    expect(() => verifyLoginWidget(data, botToken, now)).toThrow('signature does not match');
  });

  it('rejects data signed with another bot token', () => {
    const data = signLoginWidget(fields, '999:other-token');
    expect(() => verifyLoginWidget(data, botToken, now)).toThrow('signature does not match');
  });

  it('rejects data signed the Mini App way', () => {
    const data = signLoginWidget(fields, botToken, 'mini-app');
    expect(() => verifyLoginWidget(data, botToken, now)).toThrow('signature does not match');
  });

  it('rejects data older than a day', () => {
    const stale = signLoginWidget({ ...fields, auth_date: authDate - 24 * 60 * 60 }, botToken);
    expect(() => verifyLoginWidget(stale, botToken, now)).toThrow('expired');
  });

  it('rejects data without a hash or without a user ID', () => {
    const unsigned: Record<string, string | number> = { ...signLoginWidget(fields, botToken) };
    delete unsigned.hash;
    expect(() => verifyLoginWidget(unsigned, botToken, now)).toThrow('no valid hash');
    const anonymous = signLoginWidget({ first_name: 'Selam', auth_date: authDate }, botToken);
    expect(() => verifyLoginWidget(anonymous, botToken, now)).toThrow('no valid user ID');
  });
});
