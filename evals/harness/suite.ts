import type { LanguageModel } from '@buchi/server/ai/language-model';
import { z } from 'zod';

/** A metric is the mean of its per-case scores, and its goal says which side of the bound passes. */
export type Goal = { atLeast: number } | { atMost: number };

/** One dataset line after `JSON.parse`, with its line number for error messages. */
export interface DatasetRow {
  line: number;
  value: unknown;
}

export interface CaseResult {
  id: string;
  scores: Record<string, number>;
  /** What the system did, kept in the report so a failing case can be read without a rerun. */
  actual: unknown;
}

interface EvalCase {
  id: string;
  evaluate(model: LanguageModel): Promise<CaseResult>;
}

/** A suite with its case types hidden, so suites with different datasets share one list. */
export interface Suite {
  name: string;
  /** A JSONL file in `evals/datasets/`, one case per line. */
  dataset: string;
  metrics: Record<string, Goal>;
  /** Validates every row before any case runs, so a bad dataset fails without spending quota. */
  parseCases(rows: DatasetRow[]): EvalCase[];
}

interface SuiteDefinition<
  Input extends z.ZodType,
  Expected extends z.ZodType,
  Actual,
  Metric extends string,
> {
  name: string;
  dataset: string;
  input: Input;
  expected: Expected;
  metrics: Record<Metric, Goal>;
  run(input: z.output<Input>, model: LanguageModel): Promise<Actual>;
  score(
    actual: Actual,
    testCase: { input: z.output<Input>; expected: z.output<Expected> },
  ): Record<Metric, number>;
}

/** The shape every dataset line shares. Input and expected are checked by the suite's schemas. */
const envelopeSchema = z.strictObject({
  id: z.string().min(1),
  input: z.unknown(),
  expected: z.unknown(),
});

export function defineSuite<
  Input extends z.ZodType,
  Expected extends z.ZodType,
  Actual,
  Metric extends string,
>(definition: SuiteDefinition<Input, Expected, Actual, Metric>): Suite {
  const { name, dataset, metrics } = definition;

  return {
    name,
    dataset,
    metrics,
    parseCases(rows) {
      const ids = new Set<string>();
      return rows.map(({ line, value }) => {
        const where = `${dataset}:${String(line)}`;
        const { id, ...rest } = parseRow(envelopeSchema, value, where);
        if (ids.has(id)) throw new Error(`${where} repeats case id "${id}"`);
        ids.add(id);
        const testCase = {
          input: parseRow(definition.input, rest.input, `${where} input`),
          expected: parseRow(definition.expected, rest.expected, `${where} expected`),
        };
        return {
          id,
          async evaluate(model) {
            const actual = await definition.run(testCase.input, model);
            return { id, scores: definition.score(actual, testCase), actual };
          },
        };
      });
    },
  };
}

function parseRow<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  where: string,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${where} is invalid:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
