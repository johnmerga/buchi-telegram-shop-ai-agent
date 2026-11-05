import type { LanguageModel } from '@buchi/server/ai/language-model';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { Scores } from './gate';
import { evaluate } from './evaluate';
import { buildReport, meetsGoals, scoresOf } from './report';
import { defineSuite, type DatasetRow } from './suite';

const model: LanguageModel = { generate: vi.fn(), embed: vi.fn() };

/** Each case reports whether it was correct and whether it did something forbidden. */
const suite = defineSuite({
  name: 'sample',
  dataset: 'sample.jsonl',
  input: z.object({ correct: z.boolean(), forbidden: z.boolean() }),
  expected: z.object({}),
  metrics: { accuracy: { atLeast: 0.5 }, forbiddenRate: { atMost: 0 } },
  run: (input) => Promise.resolve(input),
  score: (actual) => ({
    accuracy: actual.correct ? 1 : 0,
    forbiddenRate: actual.forbidden ? 1 : 0,
  }),
});

const row = (id: string, correct: boolean, forbidden = false): DatasetRow => ({
  line: 1,
  value: { id, input: { correct, forbidden }, expected: {} },
});

async function run(rows: DatasetRow[], baseline: Scores = {}) {
  const suites = await evaluate([suite], {
    readRows: () => Promise.resolve(rows),
    modelFor: () => Promise.resolve(model),
    baseline,
  });
  return buildReport('replay', suites, new Date('2026-11-05T00:00:00Z'));
}

describe('evaluate', () => {
  it('passes when every metric meets its goal and its baseline', async () => {
    const report = await run([row('a', true), row('b', true), row('c', false)], {
      sample: { accuracy: 0.5, forbiddenRate: 0 },
    });

    expect(report.passed).toBe(true);
    expect(scoresOf(report)).toEqual({ sample: { accuracy: 2 / 3, forbiddenRate: 0 } });
    expect(report.suites[0]?.cases[2]).toEqual({
      id: 'c',
      scores: { accuracy: 0, forbiddenRate: 0 },
      actual: { correct: false, forbidden: false },
    });
  });

  it('fails when accuracy falls below its goal', async () => {
    const report = await run([row('a', true), row('b', false), row('c', false)]);

    expect(report.passed).toBe(false);
    expect(meetsGoals(report)).toBe(false);
    expect(report.suites[0]?.verdicts).toContainEqual(
      expect.objectContaining({ metric: 'accuracy', failure: 'missed_goal' }),
    );
  });

  it('fails when a forbidden outcome happens even once', async () => {
    const report = await run([row('a', true), row('b', true, true)]);

    expect(report.suites[0]?.verdicts).toContainEqual(
      expect.objectContaining({ metric: 'forbiddenRate', value: 0.5, failure: 'missed_goal' }),
    );
  });

  it('fails when accuracy drops below the baseline, while still meeting its goal', async () => {
    const report = await run([row('a', true), row('b', true), row('c', false)], {
      sample: { accuracy: 1, forbiddenRate: 0 },
    });

    expect(report.passed).toBe(false);
    expect(meetsGoals(report)).toBe(true);
    expect(report.suites[0]?.verdicts).toContainEqual({
      metric: 'accuracy',
      value: 2 / 3,
      goal: { atLeast: 0.5 },
      baseline: 1,
      failure: 'regressed',
    });
  });

  it('names the case and suite when a case throws', async () => {
    const failing = defineSuite({
      name: 'failing',
      dataset: 'failing.jsonl',
      metrics: { accuracy: { atLeast: 1 } },
      input: z.object({}),
      expected: z.object({}),
      run: () => Promise.reject(new Error('No recording for model request abc')),
      score: () => ({ accuracy: 1 }),
    });

    await expect(
      evaluate([failing], {
        readRows: () => Promise.resolve([{ line: 1, value: { id: 'x', input: {}, expected: {} } }]),
        modelFor: () => Promise.resolve(model),
        baseline: {},
      }),
    ).rejects.toThrow('Case "x" of suite failing failed');
  });

  it('refuses an empty dataset', async () => {
    await expect(run([])).rejects.toThrow('Dataset sample.jsonl has no cases');
  });
});

describe('dataset validation', () => {
  it('names the line of an invalid case before running anything', () => {
    const rows = [
      row('a', true),
      { line: 2, value: { id: 'b', input: { correct: 'yes', forbidden: false }, expected: {} } },
    ];

    expect(() => suite.parseCases(rows)).toThrow('sample.jsonl:2 input is invalid');
  });

  it('rejects a line without the case envelope', () => {
    expect(() => suite.parseCases([{ line: 3, value: { input: {}, expected: {} } }])).toThrow(
      'sample.jsonl:3 is invalid',
    );
  });

  it('rejects a repeated case id', () => {
    expect(() => suite.parseCases([row('a', true), { ...row('a', false), line: 2 }])).toThrow(
      'sample.jsonl:2 repeats case id "a"',
    );
  });
});
