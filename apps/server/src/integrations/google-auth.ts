import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
/** Google accepts assertions that live at most an hour. */
const ASSERTION_LIFETIME_S = 60 * 60;
/** Renews a little early, so a token never expires between the check and the request. */
const RENEW_BEFORE_MS = 60_000;
const TIMEOUT_MS = 10_000;

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

export interface ServiceAccount {
  email: string;
  /** The PEM private key from the service account's JSON key file. */
  privateKey: string;
}

/**
 * A Google service account's access token for the Sheets API, from the OAuth 2.0 JWT bearer flow.
 * `jose` signs the assertion, so no Google SDK is needed for one token request.
 */
export class GoogleServiceAccount {
  private cached: { token: string; expiresAt: number } | undefined;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetch: typeof globalThis.fetch,
    private readonly now: () => Date,
  ) {}

  async accessToken(): Promise<string> {
    const now = this.now().getTime();
    if (this.cached && this.cached.expiresAt - RENEW_BEFORE_MS > now) return this.cached.token;
    const response = await this.fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: await this.assertion(now),
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Google sign-in answered ${String(response.status)}`);
    const { access_token, expires_in } = tokenSchema.parse(await response.json());
    this.cached = { token: access_token, expiresAt: now + expires_in * 1000 };
    return access_token;
  }

  private async assertion(nowMs: number): Promise<string> {
    const issuedAt = Math.floor(nowMs / 1000);
    return new SignJWT({ scope: SHEETS_SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.account.email)
      .setAudience(TOKEN_URL)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + ASSERTION_LIFETIME_S)
      .sign(await importPKCS8(this.account.privateKey, 'RS256'));
  }
}
