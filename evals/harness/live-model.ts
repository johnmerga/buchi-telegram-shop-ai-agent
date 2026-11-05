import { setTimeout as sleep } from 'node:timers/promises';
import { GoogleGenAI } from '@google/genai';
import { GeminiModel } from '@buchi/server/ai/gemini';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import { QuotaManager } from '@buchi/server/ai/quota';
import { z } from 'zod';
import { Pacer } from './pacer';

const geminiEnvSchema = z.object({
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL_FAST: z.string().min(1),
  GEMINI_MODEL_SMART: z.string().min(1),
  GEMINI_MODEL_EMBED: z.string().min(1),
});

/** The free-tier limit of the stricter model (Flash), shared by every call in a run. */
const REQUESTS_PER_MINUTE = 10;
/** Gemini's default embedding size, reduced the way product search will request it. */
const EMBEDDING_DIMENSIONS = 768;
const UNLIMITED = { requestsPerMinute: Infinity, requestsPerDay: Infinity };

/** Gemini for record and live runs, paced to stay under the free tier's per-minute limit. */
export function connectGemini(env: NodeJS.ProcessEnv): LanguageModel {
  const parsed = geminiEnvSchema.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Record and live runs call Gemini and need these variables: ${missing}`);
  }
  const config = parsed.data;
  const { models } = new GoogleGenAI({ apiKey: config.GEMINI_API_KEY });
  const pacer = new Pacer(
    60_000 / REQUESTS_PER_MINUTE,
    () => performance.now(),
    (ms) => sleep(ms),
  );
  const api = {
    generateContent: async (params: Parameters<typeof models.generateContent>[0]) => {
      await pacer.turn();
      return models.generateContent(params);
    },
    embedContent: async (params: Parameters<typeof models.embedContent>[0]) => {
      await pacer.turn();
      return models.embedContent(params);
    },
  };
  return new GeminiModel(
    api,
    {
      models: {
        fast: config.GEMINI_MODEL_FAST,
        smart: config.GEMINI_MODEL_SMART,
        embedding: config.GEMINI_MODEL_EMBED,
      },
      embeddingDimensions: EMBEDDING_DIMENSIONS,
    },
    // The pacer already keeps the run under the rate limit, and the quota manager's priority
    // shares only matter when production traffic competes for the same process.
    new QuotaManager(UNLIMITED, () => new Date()),
  );
}
