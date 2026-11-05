import { ApiError } from '@google/genai';
import { z } from 'zod';
import { AppError } from '../shared/errors';

/** The JSON Schema that Gemini's structured output accepts for a `zod` schema. */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema);
  // Gemini accepts a subset of JSON Schema, and the dialect URI is not part of it.
  delete jsonSchema.$schema;
  return jsonSchema;
}

/** Model output is untrusted, so text that is not JSON becomes `undefined` for the schema to reject. */
export function parseJson(text: string | undefined): unknown {
  try {
    return JSON.parse(text ?? '');
  } catch {
    return undefined;
  }
}

/** A short code for the log. Gemini errors can echo the request, which may hold personal data. */
export function failureOf(err: unknown): string {
  if (err instanceof AppError) return err.code;
  if (err instanceof ApiError) return `gemini_${String(err.status)}`;
  return 'model_error';
}
