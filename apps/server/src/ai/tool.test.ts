import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTool } from './tool';

const lookup = defineTool({
  name: 'search_products',
  description: 'Finds products by words in their title.',
  agents: ['sales'],
  autonomy: 'automatic',
  input: z.object({
    query: z.string().min(1).describe('Words to look for'),
    limit: z.number().int().positive().default(5),
  }),
  handle: (input) => Promise.resolve({ status: 'ok', output: { echoed: input } }),
});

const context = {
  shopId: 'shop',
  runId: 'run',
  agent: 'sales' as const,
  actor: { kind: 'system' as const },
  tool: 'search_products',
};

describe('defineTool', () => {
  it('declares its parameters as JSON Schema without the dialect URI', () => {
    expect(lookup.declaration).toEqual({
      name: 'search_products',
      description: 'Finds products by words in their title.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 1, description: 'Words to look for' },
          limit: {
            type: 'integer',
            exclusiveMinimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
            default: 5,
          },
        },
        required: ['query'],
      },
    });
  });

  it('parses model arguments and hands the typed input to the handler', async () => {
    const parsed = lookup.parse({ query: 'ጫማ' });
    if (!parsed.success) throw new Error(parsed.error);

    expect(parsed.input).toEqual({ query: 'ጫማ', limit: 5 });
    expect(await parsed.run(context)).toEqual({
      status: 'ok',
      output: { echoed: { query: 'ጫማ', limit: 5 } },
    });
  });

  it('explains invalid arguments instead of throwing', () => {
    expect(lookup.parse({ query: '', limit: 'many' })).toEqual({
      success: false,
      error: expect.stringContaining('→ at limit') as unknown,
    });
  });
});
