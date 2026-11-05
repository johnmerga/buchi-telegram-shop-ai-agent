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

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
/** Rate limits and temporary server errors pass after a short wait. Anything else is final. */
const RETRYABLE_STATUSES = new Set([429, 500, 503]);

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
        const retryable = err instanceof ApiError && RETRYABLE_STATUSES.has(err.status);
        if (!retryable || attempt === MAX_ATTEMPTS) throw err;
        await this.wait(BASE_BACKOFF_MS * 2 ** (attempt - 1) * (1 + Math.random()));
      }
    }
  }
}
