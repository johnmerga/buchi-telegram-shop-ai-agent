import { ApiError, type Models } from '@google/genai';
import type {
  GenerateRequest,
  GenerateResult,
  LanguageModel,
  ModelTier,
  Priority,
} from './language-model';
import type { QuotaManager } from './quota';

/** Google counts text and embedding requests against separate quotas. */
export interface GeminiQuotas {
  generate: QuotaManager;
  embed: QuotaManager;
}

export interface GeminiConfig {
  models: Record<ModelTier, string> & { embedding: string };
  embeddingDimensions: number;
}

/**
 * Attempts per call. Gemini's overload spells can last many seconds, and a payment check holds an
 * order, so it tries longer than a chat reply, which the customer is watching.
 */
const MAX_ATTEMPTS: Record<Priority, number> = {
  payment: 5,
  customer: 3,
  operations: 4,
  owner: 3,
};
const BASE_BACKOFF_MS = 1000;
/** Rate limits and temporary server errors pass after a short wait. Anything else is final. */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
/**
 * The longest wait for Google's rate-limit delay. A customer is waiting for a reply and a payment
 * check holds an order, so they give up sooner than background operations and owner requests.
 */
const MAX_RATE_LIMIT_WAIT_MS: Record<Priority, number> = {
  payment: 10_000,
  customer: 10_000,
  operations: 20_000,
  owner: 20_000,
};

/**
 * What a 429 says about waiting: Google's `RetryInfo` delay, or `Infinity` when the daily quota is
 * spent. The SDK puts the JSON error body in the message, so anything unreadable has no delay.
 */
function rateLimitDelayMs(err: ApiError): number | undefined {
  if (err.status !== 429) return undefined;
  if (/PerDay/.test(err.message)) return Infinity;
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(err.message)?.[1];
  return delay === undefined ? undefined : Number(delay) * 1000;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Gemini behind the `LanguageModel` interface, with model routing, quota, and retries. */
export class GeminiModel implements LanguageModel {
  constructor(
    private readonly api: Pick<Models, 'generateContent' | 'embedContent'>,
    private readonly config: GeminiConfig,
    private readonly quotas: GeminiQuotas,
    private readonly wait: (ms: number) => Promise<void> = sleep,
  ) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const response = await this.withRetries(this.quotas.generate, request.priority, () =>
      this.api.generateContent({
        model: this.config.models[request.tier],
        contents: request.contents,
        config: {
          ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {}),
          ...(request.tools ? { tools: [{ functionDeclarations: request.tools }] } : {}),
          ...(request.responseJsonSchema
            ? {
                responseMimeType: 'application/json',
                responseJsonSchema: request.responseJsonSchema,
              }
            : {}),
        },
      }),
    );
    return {
      content: response.candidates?.[0]?.content ?? { role: 'model', parts: [] },
      text: response.text,
      functionCalls: response.functionCalls ?? [],
      usage: {
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }

  async embed(text: string, priority: Priority): Promise<number[]> {
    const response = await this.withRetries(this.quotas.embed, priority, () =>
      this.api.embedContent({
        model: this.config.models.embedding,
        contents: text,
        config: { outputDimensionality: this.config.embeddingDimensions },
      }),
    );
    const values = response.embeddings?.[0]?.values;
    if (!values) throw new Error('Gemini returned no embedding');
    return values;
  }

  /** Every attempt takes quota, so retries cannot exceed the limits that protect payment checks. */
  private async withRetries<T>(
    quota: QuotaManager,
    priority: Priority,
    call: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      quota.acquire(priority);
      try {
        return await call();
      } catch (err) {
        if (!(err instanceof ApiError) || !RETRYABLE_STATUSES.has(err.status)) throw err;
        const delay = rateLimitDelayMs(err);
        if (attempt === MAX_ATTEMPTS[priority] || (delay ?? 0) > MAX_RATE_LIMIT_WAIT_MS[priority]) {
          throw err;
        }
        await this.wait(delay ?? BASE_BACKOFF_MS * 2 ** (attempt - 1) * (1 + Math.random()));
      }
    }
  }
}
