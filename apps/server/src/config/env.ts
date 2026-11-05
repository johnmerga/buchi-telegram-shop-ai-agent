import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  // Telegram accepts 1 to 256 of these characters. 32 or more keeps the secret hard to guess.
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  /** Shared with the cron service, which sends it in the `x-job-secret` header. */
  JOB_SECRET: z.string().min(32),
  /** Signs the bearer tokens that Mini Apps send to the API. */
  AUTH_TOKEN_SECRET: z.string().min(32),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL_FAST: z.string().min(1).default('gemini-2.5-flash-lite'),
  GEMINI_MODEL_SMART: z.string().min(1).default('gemini-2.5-flash'),
  GEMINI_MODEL_EMBED: z.string().min(1).default('gemini-embedding-001'),
  GEMINI_EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(768),
  /** Requests per minute and per Pacific day. Defaults stay under the free tier's limits. */
  GEMINI_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  GEMINI_REQUESTS_PER_DAY: z.coerce.number().int().positive().default(250),
  /** Keys the payer hashes in the shared risk signals. Changing it forgets every signal. */
  RISK_HASH_SECRET: z.string().min(32),
  /** HeiGIT basic key for OpenRouteService, sent as the raw `Authorization` header. */
  ORS_API_KEY: z.string().min(1),
  ORS_BASE_URL: z.url().default('https://api.heigit.org'),
  /** Nominatim's usage policy requires a user agent that identifies the application. */
  NOMINATIM_USER_AGENT: z
    .string()
    .min(1)
    .default('Buchi/1.0 (contact via GitHub johnmerga/buchi-telegram-shop-ai-agent)'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

/** Parses the environment once at startup and names every invalid or missing variable. */
export function loadEnv(source: NodeJS.ProcessEnv): Env {
  return parse(envSchema, source);
}

/** The migration runner needs only the database, so it starts before the other secrets exist. */
export function loadDatabaseUrl(source: NodeJS.ProcessEnv): string {
  return parse(envSchema.pick({ DATABASE_URL: true }), source).DATABASE_URL;
}

function parse<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment variables:\n${problems.join('\n')}`);
  }
  return result.data;
}
