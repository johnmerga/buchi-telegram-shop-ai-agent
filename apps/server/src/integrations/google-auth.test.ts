import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { describe, expect, it } from 'vitest';
import { urlOf } from '../../test/fakes/fetch';
import { GoogleServiceAccount } from './google-auth';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const email = 'ledger@buchi.iam.gserviceaccount.com';

function accountAnswering(status = 200) {
  const requests: { url: string; body: URLSearchParams }[] = [];
  let now = new Date('2026-11-05T12:00:00Z');
  const fetch: typeof globalThis.fetch = (input, init) => {
    requests.push({
      url: urlOf(input),
      body: new URLSearchParams(typeof init?.body === 'string' ? init.body : ''),
    });
    return Promise.resolve(
      Response.json(
        { access_token: `token-${String(requests.length)}`, expires_in: 3600 },
        { status },
      ),
    );
  };
  const account = new GoogleServiceAccount({ email, privateKey: pem }, fetch, () => now);
  return { account, requests, advance: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

describe('GoogleServiceAccount', () => {
  it('signs a one-hour RS256 assertion for the Sheets scope', async () => {
    const { account, requests } = accountAnswering();
    await expect(account.accessToken()).resolves.toBe('token-1');
    const [request] = requests;
    expect(request?.url).toBe('https://oauth2.googleapis.com/token');
    expect(request?.body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = request?.body.get('assertion') ?? '';
    expect(decodeProtectedHeader(assertion)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = decodeJwt(assertion);
    expect(claims).toMatchObject({
      iss: email,
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/spreadsheets',
    });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(3600);
  });

  it('reuses the token until a minute before it expires', async () => {
    const { account, requests, advance } = accountAnswering();
    await account.accessToken();
    advance(58 * 60_000);
    await expect(account.accessToken()).resolves.toBe('token-1');
    advance(60_000);
    await expect(account.accessToken()).resolves.toBe('token-2');
    expect(requests).toHaveLength(2);
  });

  it('fails without echoing the answer when Google refuses the key', async () => {
    const { account } = accountAnswering(400);
    await expect(account.accessToken()).rejects.toThrow('Google sign-in answered 400');
  });
});
