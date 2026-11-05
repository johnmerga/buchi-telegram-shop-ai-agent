import { z } from 'zod';
import { parseJson } from '../../structured-output';
import { numbersIn } from '../sales/reply-prices.domain';

const MAX_SUGGESTIONS = 3;

const suggestionsSchema = z.object({
  suggestions: z
    .array(
      z.object({
        text: z.string().trim().min(10).max(400),
        rule: z.record(z.string(), z.unknown()),
      }),
    )
    .max(MAX_SUGGESTIONS),
});
export type Suggestion = z.output<typeof suggestionsSchema>['suggestions'][number];

/** The model's JSON reply, with code fences if it added them anyway. Malformed output is none. */
export function parseSuggestions(reply: string): Suggestion[] | undefined {
  const json = reply.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const parsed = suggestionsSchema.safeParse(parseJson(json));
  return parsed.success ? parsed.data.suggestions : undefined;
}

/**
 * The numbers in a suggestion's text that the analysis did not return. A suggestion keeps only
 * figures from the query results; the new value it proposes appears in the code-built preview.
 */
export function unsupportedNumbers(text: string, findings: string): string[] {
  const known = new Set(numbersIn(findings));
  return numbersIn(text).filter((number) => !known.has(number));
}
