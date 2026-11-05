import type { Goal } from './suite';

/** Metric values per suite: the shape of the baseline file and of a run's scores. */
export type Scores = Record<string, Record<string, number>>;

export interface Verdict {
  metric: string;
  value: number;
  goal: Goal;
  baseline: number | undefined;
  failure: 'missed_goal' | 'regressed' | null;
}

/**
 * Checks each metric against its goal and against the baseline. "Worse" means lower, except for
 * an `atMost` goal, where a higher value is worse. A metric without a baseline is new and passes on
 * its goal alone.
 */
export function judge(
  values: Record<string, number>,
  goals: Record<string, Goal>,
  baseline: Record<string, number> | undefined,
): Verdict[] {
  return Object.entries(goals).map(([metric, goal]) => {
    const value = values[metric];
    if (value === undefined) throw new Error(`Metric ${metric} has no value`);
    const previous = baseline?.[metric];
    const worse = (a: number, b: number) => ('atLeast' in goal ? a < b : a > b);
    const bound = 'atLeast' in goal ? goal.atLeast : goal.atMost;
    let failure: Verdict['failure'] = null;
    if (worse(value, bound)) failure = 'missed_goal';
    else if (previous !== undefined && worse(value, previous)) failure = 'regressed';
    return { metric, value, goal, baseline: previous, failure };
  });
}
