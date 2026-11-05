import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { verifyInitData } from './init-data.domain';
import { verifyLoginWidget, type LoginWidgetData } from './login-widget.domain';

const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;
const ALGORITHM = 'HS256';

const subjectSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number);

/** The signed-in Telegram user behind an API request. */
export interface Caller {
  telegramUserId: number;
}

export interface Session {
  token: string;
  expiresAt: Date;
}

export interface AuthServiceDeps {
  botToken: string;
  tokenSecret: string;
  now: () => Date;
}

export class AuthService {
  private readonly key: Uint8Array;

  constructor(private readonly deps: AuthServiceDeps) {
    this.key = new TextEncoder().encode(deps.tokenSecret);
  }

  async signInWithMiniApp(initData: string): Promise<Session> {
    const now = this.deps.now();
    return await this.issue(verifyInitData(initData, this.deps.botToken, now), now);
  }

  /** The browser dashboard's sign-in. It issues the same token as the Mini App sign-in. */
  async signInWithLoginWidget(data: LoginWidgetData): Promise<Session> {
    const now = this.deps.now();
    return await this.issue(verifyLoginWidget(data, this.deps.botToken, now), now);
  }

  private async issue(telegramUserId: number, now: Date): Promise<Session> {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = issuedAt + TOKEN_LIFETIME_SECONDS;
    const token = await new SignJWT()
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(String(telegramUserId))
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(this.key);
    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  async verifyToken(token: string): Promise<Caller> {
    const payload = await jwtVerify(token, this.key, {
      algorithms: [ALGORITHM],
      currentDate: this.deps.now(),
    }).then(
      (result) => result.payload,
      (err: unknown) => {
        if (err instanceof errors.JOSEError) {
          throw new AppError('UNAUTHORIZED', 'Invalid or expired token');
        }
        throw err;
      },
    );
    const subject = subjectSchema.safeParse(payload.sub);
    if (!subject.success) throw new AppError('UNAUTHORIZED', 'Token has no valid subject');
    return { telegramUserId: subject.data };
  }
}
