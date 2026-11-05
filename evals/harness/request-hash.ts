import { createHash } from 'node:crypto';
import type { GenerateRequest } from '@buchi/server/ai/language-model';

/**
 * The parts of a request that decide the model's answer. Priority only orders calls in the quota
 * manager, so changing it must not orphan a recording.
 */
export type RequestKey = Omit<GenerateRequest, 'priority'>;

export function requestKey({ priority: _priority, ...key }: GenerateRequest): RequestKey {
  return key;
}

/** A SHA-256 of the key as canonical JSON, so key order and absent fields never change it. */
export function hashRequestKey(key: RequestKey): string {
  return createHash('sha256').update(canonicalJson(key)).digest('hex');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) =>
    isPlainObject(nested) ? Object.fromEntries(Object.entries(nested).sort(byKey)) : nested,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Code-unit order, not `localeCompare`, so the hash is the same on every machine. */
function byKey([a]: [string, unknown], [b]: [string, unknown]): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
