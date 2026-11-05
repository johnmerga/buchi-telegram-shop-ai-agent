import { z } from 'zod';

const variablesSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * Proxies between the client and the server, which each append to `X-Forwarded-For`. Rate limits
   * key on the address that many hops back. 0 locally; on Render, Cloudflare and Render's own proxy.
   */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
  DATABASE_URL: z.url(),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  // Telegram accepts 1 to 256 of these characters. 32 or more keeps the secret hard to guess.
  TELEGRAM_WEBHOOK_SECRET: z.string().regex(/^[A-Za-z0-9_-]{32,256}$/),
  /** Shared with the cron service, which sends it in the `x-job-secret` header. */
  JOB_SECRET: z.string().min(32),
  /** Signs the bearer tokens that Mini Apps send to the API. */
  AUTH_TOKEN_SECRET: z.string().min(32),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL_FAST: z.string().min(1).default('gemini-3.5-flash-lite'),
  /**
   * The free tier allows Flash only 20 requests a day, so both tiers default to Flash-Lite. With
   * billing, a stronger model here serves negotiation, receipts, estimates, and SQL.
   */
  GEMINI_MODEL_SMART: z.string().min(1).default('gemini-3.5-flash-lite'),
  GEMINI_MODEL_EMBED: z.string().min(1).default('gemini-embedding-001'),
  /** Text requests per minute and per Pacific day. Defaults match Flash-Lite's free tier. */
  GEMINI_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(15),
  GEMINI_REQUESTS_PER_DAY: z.coerce.number().int().positive().default(500),
  /** Embedding requests have their own quota at Google, so they have their own limits here. */
  GEMINI_EMBED_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(100),
  GEMINI_EMBED_REQUESTS_PER_DAY: z.coerce.number().int().positive().default(1000),
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
  /**
   * The public HTTPS address of this server, such as https://buchi.onrender.com. Chat buttons open
   * the Mini Apps there. Telegram opens only HTTPS links, so without it the chat shows none.
   */
  WEB_APP_URL: z.url({ protocol: /^https$/ }).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /**
   * The Google service account that writes the owners' Sheets ledgers. Without both, the server
   * still starts and ledger rows wait in the database.
   */
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.email().optional(),
  /** The PEM private key. Hosts that keep one-line values store its line breaks as "\\n". */
  GOOGLE_SERVICE_ACCOUNT_KEY: z
    .string()
    .min(1)
    .transform((key) => key.replaceAll('\\n', '\n'))
    .optional(),
});

/** The Gemini key and model IDs, with the server's defaults, for tools that call Gemini directly. */
export const geminiVariablesSchema = variablesSchema.pick({
  GEMINI_API_KEY: true,
  GEMINI_MODEL_FAST: true,
  GEMINI_MODEL_SMART: true,
  GEMINI_MODEL_EMBED: true,
});

const envSchema = variablesSchema.refine(
  (env) =>
    (env.GOOGLE_SERVICE_ACCOUNT_EMAIL === undefined) ===
    (env.GOOGLE_SERVICE_ACCOUNT_KEY === undefined),
  {
    message: 'Set both GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_KEY, or neither',
    path: ['GOOGLE_SERVICE_ACCOUNT_KEY'],
  },
);

export type Env = z.infer<typeof envSchema>;

/** Parses the environment once at startup and names every invalid or missing variable. */
export function loadEnv(source: NodeJS.ProcessEnv): Env {
  return parse(envSchema, source);
}

/** The migration runner needs only the database, so it starts before the other secrets exist. */
export function loadDatabaseUrl(source: NodeJS.ProcessEnv): string {
  return parse(variablesSchema.pick({ DATABASE_URL: true }), source).DATABASE_URL;
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
