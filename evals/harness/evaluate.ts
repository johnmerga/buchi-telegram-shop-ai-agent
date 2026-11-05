import type { LanguageModel } from '@buchi/server/ai/language-model';
import { judge, type Scores, type Verdict } from './gate';
import type { CaseResult, DatasetRow, Goal, Suite } from './suite';

export interface SuiteReport {
  name: string;
  verdicts: Verdict[];
  cases: CaseResult[];
}

interface EvaluateDeps {
  readRows(dataset: string): Promise<DatasetRow[]>;
  /** A replaying, recording, or live model, depending on the mode. */
  modelFor(suite: string): Promise<LanguageModel>;
  baseline: Scores;
}

/**
 * Runs every case of every suite and judges the metrics. Cases run one at a time, because the
 * free tier allows only a few requests a minute and a fixed order keeps reports comparable.
 */
export async function evaluate(
  suites: readonly Suite[],
  deps: EvaluateDeps,
): Promise<SuiteReport[]> {
  const reports: SuiteReport[] = [];
  for (const suite of suites) {
    const cases = suite.parseCases(await deps.readRows(suite.dataset));
    if (cases.length === 0) throw new Error(`Dataset ${suite.dataset} has no cases`);
    const model = await deps.modelFor(suite.name);
    const results: CaseResult[] = [];
    for (const testCase of cases) {
      try {
        results.push(await testCase.evaluate(model));
      } catch (err) {
        throw new Error(`Case "${testCase.id}" of suite ${suite.name} failed`, { cause: err });
      }
    }
    const values = meanScores(results, suite.metrics);
    reports.push({
      name: suite.name,
      verdicts: judge(values, suite.metrics, deps.baseline[suite.name]),
      cases: results,
    });
  }
  return reports;
}

function meanScores(results: CaseResult[], goals: Record<string, Goal>): Record<string, number> {
  return Object.fromEntries(
    Object.keys(goals).map((metric) => {
      const total = results.reduce((sum, result) => {
        const score = result.scores[metric];
        if (score === undefined) throw new Error(`Case "${result.id}" has no ${metric} score`);
        return sum + score;
      }, 0);
      return [metric, total / results.length];
    }),
  );
}
