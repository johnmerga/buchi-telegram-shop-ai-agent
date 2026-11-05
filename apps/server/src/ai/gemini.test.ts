import { ApiError, GenerateContentResponse, type Models } from '@google/genai';
import { describe, expect, it, vi } from 'vitest';
import { GeminiModel } from './gemini';
import type { GenerateRequest } from './language-model';
import { QuotaManager } from './quota';

const config = {
  models: { fast: 'model-fast', smart: 'model-smart', embedding: 'model-embed' },
  embeddingDimensions: 768,
};

function responseWith(text: string): GenerateContentResponse {
  const response = new GenerateContentResponse();
  response.candidates = [{ content: { role: 'model', parts: [{ text }] } }];
  response.usageMetadata = { promptTokenCount: 12, candidatesTokenCount: 3 };
  return response;
}

const quotaOf = (requestsPerMinute: number) =>
  new QuotaManager({ requestsPerMinute, requestsPerDay: 1000 }, () => new Date());

function setUp(
  generateContent: Models['generateContent'],
  requestsPerMinute = 100,
  embedContent = vi.fn<Models['embedContent']>(),
) {
  const quotas = { generate: quotaOf(requestsPerMinute), embed: quotaOf(100) };
  return new GeminiModel({ generateContent, embedContent }, config, quotas, () =>
    Promise.resolve(),
  );
}

const request: GenerateRequest = { tier: 'smart', priority: 'customer', contents: [] };

describe('GeminiModel', () => {
  it('routes the tier to its model and reports the turn and token usage', async () => {
    const generate = vi.fn<Models['generateContent']>().mockResolvedValue(responseWith('ሰላም'));
    const result = await setUp(generate).generate(request);

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'model-smart' }));
    expect(result).toEqual({
      content: { role: 'model', parts: [{ text: 'ሰላም' }] },
      text: 'ሰላም',
      functionCalls: [],
      usage: { inputTokens: 12, outputTokens: 3 },
    });
  });

  it('asks for JSON when a schema is given', async () => {
    const generate = vi.fn<Models['generateContent']>().mockResolvedValue(responseWith('{}'));
    await setUp(generate).generate({ ...request, responseJsonSchema: { type: 'object' } });

    expect(generate.mock.calls[0]?.[0].config).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: { type: 'object' },
    });
  });

  it('retries a rate-limited call and then succeeds', async () => {
    const generate = vi
      .fn<Models['generateContent']>()
      .mockRejectedValueOnce(new ApiError({ message: 'busy', status: 429 }))
      .mockResolvedValue(responseWith('ok'));

    expect((await setUp(generate).generate(request)).text).toBe('ok');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('does not retry a request that Gemini rejects as invalid', async () => {
    const generate = vi
      .fn<Models['generateContent']>()
      .mockRejectedValue(new ApiError({ message: 'bad request', status: 400 }));

    await expect(setUp(generate).generate(request)).rejects.toThrow('bad request');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when retries would exceed the quota', async () => {
    const generate = vi
      .fn<Models['generateContent']>()
      .mockRejectedValue(new ApiError({ message: 'busy', status: 503 }));

    await expect(
      setUp(generate, 2).generate({ ...request, priority: 'payment' }),
    ).rejects.toMatchObject({
      code: 'QUOTA_EXHAUSTED',
    });
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('counts embeddings against their own quota, not the text quota', async () => {
    const generate = vi.fn<Models['generateContent']>().mockResolvedValue(responseWith('ok'));
    const embed = vi
      .fn<Models['embedContent']>()
      .mockResolvedValue({ embeddings: [{ values: [0.1, 0.2] }] });
    const model = setUp(generate, 1, embed);

    await model.generate({ ...request, priority: 'payment' });
    await expect(model.embed('red boots', 'payment')).resolves.toEqual([0.1, 0.2]);
  });
});
