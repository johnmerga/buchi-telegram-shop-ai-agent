import type { GenerateRequest } from '@buchi/server/ai/language-model';
import { describe, expect, it } from 'vitest';
import { hashRequestKey, requestKey } from './request-hash';

const request: GenerateRequest = {
  tier: 'smart',
  priority: 'customer',
  systemInstruction: 'You sell shoes.',
  contents: [{ role: 'user', parts: [{ text: 'ዋጋ?' }] }],
  tools: [{ name: 'offer_price', parametersJsonSchema: { type: 'object', required: ['price'] } }],
};

const hashOf = (value: GenerateRequest) => hashRequestKey(requestKey(value));

describe('request hash', () => {
  it('stays the same across releases, so committed recordings keep matching', () => {
    expect(hashOf(request)).toBe(
      '19f2e6087ac4bd62bef07990a829f49cf4318f6ad309c9e29c1dad87b35ac369',
    );
  });

  it('ignores key order', () => {
    const reordered: GenerateRequest = {
      tools: [
        { parametersJsonSchema: { required: ['price'], type: 'object' }, name: 'offer_price' },
      ],
      contents: [{ parts: [{ text: 'ዋጋ?' }], role: 'user' }],
      systemInstruction: 'You sell shoes.',
      priority: 'customer',
      tier: 'smart',
    };
    expect(hashOf(reordered)).toBe(hashOf(request));
  });

  it('ignores the quota priority', () => {
    expect(hashOf({ ...request, priority: 'owner' })).toBe(hashOf(request));
  });

  it('changes with anything the model sees', () => {
    const variants: GenerateRequest[] = [
      { ...request, tier: 'fast' },
      { ...request, systemInstruction: 'You sell bags.' },
      { ...request, contents: [{ role: 'user', parts: [{ text: 'ዋጋ ስንት ነው?' }] }] },
      { ...request, tools: [] },
      { ...request, responseJsonSchema: { type: 'object' } },
    ];
    const hashes = new Set([hashOf(request), ...variants.map(hashOf)]);
    expect(hashes.size).toBe(variants.length + 1);
  });
});
