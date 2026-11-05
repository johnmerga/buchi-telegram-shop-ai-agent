import { sessionSchema } from '@buchi/shared';
import { readError } from './api-error';

/** A token this close to expiry is renewed first, so a request never starts with a dying token. */
const RENEW_MARGIN_MS = 60_000;

export type SignIn = () => Promise<{ token: string; expiresAt: Date }>;

/**
 * Holds the bearer token in memory only, never in storage. When it expires, it signs in again
 * with the same credentials, which Telegram signs for 24 hours.
 */
export class Auth {
  private session: { token: string; expiresAt: Date } | undefined;
  private pending: Promise<string> | undefined;

  constructor(
    private readonly signIn: SignIn,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** One sign-in at a time: parallel requests share it. */
  token(): Promise<string> {
    const session = this.session;
    if (session && session.expiresAt.getTime() - this.now().getTime() > RENEW_MARGIN_MS) {
      return Promise.resolve(session.token);
    }
    this.pending ??= this.signIn()
      .then((fresh) => {
        this.session = fresh;
        return fresh.token;
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  /** Forgets a token the server rejected, so the next request signs in again. */
  invalidate(): void {
    this.session = undefined;
  }
}

/** Exchanges Telegram-signed credentials at one of the server's sign-in endpoints. */
export function exchange(path: '/auth/mini-app' | '/auth/login-widget', body: object): SignIn {
  return async () => {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await readError(res);
    const session = sessionSchema.parse(await res.json());
    return { token: session.token, expiresAt: new Date(session.expiresAt) };
  };
}
