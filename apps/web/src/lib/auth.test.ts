import { describe, expect, it, vi } from 'vitest';
import { Auth } from './auth';

const at = (iso: string) => new Date(iso);

describe('Auth', () => {
  it('signs in once and reuses the token while it is fresh', async () => {
    const signIn = vi.fn(() =>
      Promise.resolve({ token: 'one', expiresAt: at('2026-11-05T12:00:00Z') }),
    );
    const auth = new Auth(signIn, () => at('2026-11-05T10:00:00Z'));
    expect(await auth.token()).toBe('one');
    expect(await auth.token()).toBe('one');
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('shares one sign-in between parallel requests', async () => {
    const signIn = vi.fn(() =>
      Promise.resolve({ token: 'one', expiresAt: at('2026-11-05T12:00:00Z') }),
    );
    const auth = new Auth(signIn, () => at('2026-11-05T10:00:00Z'));
    expect(await Promise.all([auth.token(), auth.token()])).toEqual(['one', 'one']);
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it('signs in again shortly before the token expires', async () => {
    let now = at('2026-11-05T10:00:00Z');
    const tokens = ['one', 'two'];
    const auth = new Auth(
      () => Promise.resolve({ token: tokens.shift() ?? '', expiresAt: at('2026-11-05T12:00:00Z') }),
      () => now,
    );
    expect(await auth.token()).toBe('one');
    now = at('2026-11-05T11:59:30Z');
    expect(await auth.token()).toBe('two');
  });

  it('signs in again after the server rejected the token', async () => {
    const tokens = ['one', 'two'];
    const auth = new Auth(
      () => Promise.resolve({ token: tokens.shift() ?? '', expiresAt: at('2026-11-05T12:00:00Z') }),
      () => at('2026-11-05T10:00:00Z'),
    );
    await auth.token();
    auth.invalidate();
    expect(await auth.token()).toBe('two');
  });

  it('lets a failed sign-in be retried', async () => {
    const signIn = vi
      .fn<() => Promise<{ token: string; expiresAt: Date }>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ token: 'one', expiresAt: at('2026-11-05T12:00:00Z') });
    const auth = new Auth(signIn, () => at('2026-11-05T10:00:00Z'));
    await expect(auth.token()).rejects.toThrow('offline');
    expect(await auth.token()).toBe('one');
  });
});
