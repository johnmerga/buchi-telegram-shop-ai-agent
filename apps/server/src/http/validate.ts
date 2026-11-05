import type { z } from 'zod';
import { AppError } from '../shared/errors';

/** Parses untrusted input at the HTTP boundary and turns failures into a 400 with the reasons. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const reasons = result.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`);
    throw new AppError('VALIDATION_FAILED', reasons.join('; '));
  }
  return result.data;
}
