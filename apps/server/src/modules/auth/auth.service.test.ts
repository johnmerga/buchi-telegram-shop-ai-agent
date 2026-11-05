import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { launchFields, signInitData } from '../../../test/sign-init-data';
import { AuthService } from './auth.service';

const botToken = '123456:test-bot-token';
const tokenSecret = 'test-auth-token-secret-at-least-32-chars';
const signedInAt = new Date('2026-11-05T12:00:00Z');

function serviceAt(now: Date, secret = tokenSecret): AuthService {
  return new AuthService({ botToken, tokenSecret: secret, now: () => now });
}

async function signIn(userId = 42): Promise<string> {
  const session = await serviceAt(signedInAt).signInWithMiniApp(
    signInitData(launchFields(userId, signedInAt), botToken),
  );
  return session.token;
}

describe('AuthService', () => {
  it('issues a token that expires 12 hours after sign-in', async () => {
    const session = await serviceAt(signedInAt).signInWithMiniApp(
      signInitData(launchFields(42, signedInAt), botToken),
    );
    expect(session.expiresAt).toEqual(new Date('2026-11-06T00:00:00Z'));
  });

  it('rejects launch data that fails verification', async () => {
    await expect(serviceAt(signedInAt).signInWithMiniApp('hash=abc')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('verifies its own token to the signed-in user', async () => {
    const token = await signIn(42);
    await expect(serviceAt(signedInAt).verifyToken(token)).resolves.toEqual({
      telegramUserId: 42,
    });
  });

  it('accepts a token until it expires', async () => {
    const token = await signIn();
    const justBefore = new Date('2026-11-05T23:59:59Z');
    await expect(serviceAt(justBefore).verifyToken(token)).resolves.toBeDefined();
  });

  it('rejects an expired token', async () => {
    const token = await signIn();
    const afterExpiry = new Date('2026-11-06T00:00:01Z');
    await expect(serviceAt(afterExpiry).verifyToken(token)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects a token signed with another secret', async () => {
    const token = await signIn();
    const other = serviceAt(signedInAt, 'another-secret-that-is-also-32-chars-long');
    await expect(other.verifyToken(token)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('rejects a token that is not a JWT', async () => {
    await expect(serviceAt(signedInAt).verifyToken('garbage')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects a correctly signed token without a Telegram user ID', async () => {
    const token = await new SignJWT()
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('not-a-user-id')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(tokenSecret));
    await expect(serviceAt(new Date()).verifyToken(token)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
});
