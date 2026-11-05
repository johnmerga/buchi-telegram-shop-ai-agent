import type { z } from 'zod';

/** The first message for each field path, such as `lowestPrice` or `0.stock`, keyed by that path. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || 'form';
    errors[key] ??= issue.message;
  }
  return errors;
}
