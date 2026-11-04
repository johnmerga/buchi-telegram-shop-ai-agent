import { pino, type Logger } from 'pino';
import type { Env } from './env';

/** Paths that can hold secrets or personal data. Logs never contain them. */
const redactPaths = [
  'req.headers.authorization',
  'req.headers["x-telegram-bot-api-secret-token"]',
  'req.headers["x-job-secret"]',
  '*.phone',
  '*.initData',
];

export function createLogger(env: Pick<Env, 'LOG_LEVEL'>): Logger {
  return pino({ level: env.LOG_LEVEL, redact: { paths: redactPaths, censor: '[redacted]' } });
}
