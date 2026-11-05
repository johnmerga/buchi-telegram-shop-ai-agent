import type { Scores, Verdict } from './gate';
import type { SuiteReport } from './evaluate';

interface Report {
  mode: string;
  finishedAt: string;
  passed: boolean;
  suites: SuiteReport[];
}

export function buildReport(mode: string, suites: SuiteReport[], finishedAt: Date): Report {
  const passed = suites.every((suite) => suite.verdicts.every((verdict) => !verdict.failure));
  return { mode, finishedAt: finishedAt.toISOString(), passed, suites };
}

/** A new baseline may be lower than the last one, but it must still meet every goal. */
export function meetsGoals(report: Report): boolean {
  return report.suites.every((suite) =>
    suite.verdicts.every((verdict) => verdict.failure !== 'missed_goal'),
  );
}

export function scoresOf(report: Report): Scores {
  return Object.fromEntries(
    report.suites.map((suite) => [
      suite.name,
      Object.fromEntries(suite.verdicts.map((verdict) => [verdict.metric, verdict.value])),
    ]),
  );
}

const headers = ['suite', 'metric', 'value', 'goal', 'baseline', 'result'];

/** One row per metric, as a plain-text table for the terminal and the CI log. */
export function formatTable(report: Report): string {
  const rows = report.suites.flatMap((suite) =>
    suite.verdicts.map((verdict) => [
      suite.name,
      verdict.metric,
      verdict.value.toFixed(3),
      formatGoal(verdict.goal),
      verdict.baseline?.toFixed(3) ?? '-',
      formatResult(verdict),
    ]),
  );
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  return [headers, ...rows]
    .map((row) => row.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  '))
    .map((line) => line.trimEnd())
    .join('\n');
}

function formatGoal(goal: Verdict['goal']): string {
  return 'atLeast' in goal ? `>= ${goal.atLeast.toFixed(3)}` : `<= ${goal.atMost.toFixed(3)}`;
}

function formatResult({ failure }: Verdict): string {
  if (failure === 'missed_goal') return 'FAIL (goal)';
  if (failure === 'regressed') return 'FAIL (baseline)';
  return 'pass';
}
