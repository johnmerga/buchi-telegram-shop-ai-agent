import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import { connectDatabase } from '@buchi/server/db/client';
import { z } from 'zod';
import { readBaseline, writeBaseline } from './harness/baseline';
import { readDataset } from './harness/dataset';
import { recreateEvalDatabase } from './harness/eval-database';
import { evaluate } from './harness/evaluate';
import { connectGemini } from './harness/live-model';
import { RecordingModel } from './harness/recording-model';
import { RecordingStore } from './harness/recording-store';
import { ReplayModel } from './harness/replay-model';
import { buildReport, formatTable, meetsGoals, scoresOf } from './harness/report';
import { createSuites } from './suites';

const pathIn = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const baselinePath = pathIn('./baseline.json');
const reportPath = pathIn('./report.json');

/**
 * `replay` serves recorded responses (CI, no network). `record` calls Gemini and replaces the
 * recordings. `live` calls Gemini without saving anything (the nightly run).
 */
const modeSchema = z.enum(['replay', 'record', 'live']);
type Mode = z.infer<typeof modeSchema>;

const argsSchema = z.object({
  mode: modeSchema,
  updateBaseline: z.boolean(),
  /** Runs one suite, so a prompt change re-records only the suites it affects. */
  suite: z.string().min(1).optional(),
});

const envSchema = z.object({
  EVALS_DATABASE_URL: z.url().default('postgres://buchi:buchi@localhost:5432/buchi_evals'),
});

async function main(): Promise<boolean> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'update-baseline': { type: 'boolean', default: false },
      suite: { type: 'string' },
    },
  });
  const args = argsSchema.safeParse({
    mode: positionals[0],
    updateBaseline: values['update-baseline'],
    suite: values.suite,
  });
  if (!args.success) {
    throw new Error('Usage: cli.ts <replay|record|live> [--suite <name>] [--update-baseline]');
  }
  const { mode, updateBaseline, suite } = args.data;
  const { EVALS_DATABASE_URL } = envSchema.parse(process.env);
  const modelFor = modelSource(mode);

  await recreateEvalDatabase(EVALS_DATABASE_URL);
  const { db, close } = connectDatabase(EVALS_DATABASE_URL);
  try {
    const chosen = createSuites(db).filter((s) => suite === undefined || s.name === suite);
    if (chosen.length === 0) throw new Error(`There is no suite named ${suite ?? ''}`);
    const baseline = await readBaseline(baselinePath);
    const suites = await evaluate(chosen, {
      readRows: (dataset) => readDataset(pathIn(`./datasets/${dataset}`)),
      modelFor,
      baseline,
    });
    const report = buildReport(mode, suites, new Date());
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`${formatTable(report)}\n\nReport: ${reportPath}`);
    if (!updateBaseline) return report.passed;
    if (!meetsGoals(report)) {
      console.error('The baseline was not updated, because a metric misses its goal.');
      return false;
    }
    // A run of one suite keeps the other suites' baselines.
    await writeBaseline(baselinePath, { ...baseline, ...scoresOf(report) });
    console.log(`Baseline updated: ${baselinePath}`);
    return true;
  } finally {
    await close();
  }
}

function modelSource(mode: Mode): (suite: string) => Promise<LanguageModel> {
  const storeFor = (suite: string) => new RecordingStore(pathIn(`./recordings/${suite}`));
  if (mode === 'replay') return (suite) => Promise.resolve(new ReplayModel(storeFor(suite)));
  const gemini = connectGemini(process.env);
  if (mode === 'live') return () => Promise.resolve(gemini);
  return async (suite) => {
    const store = storeFor(suite);
    await store.clear();
    return new RecordingModel(gemini, store);
  };
}

main().then(
  (passed) => {
    process.exitCode = passed ? 0 : 1;
  },
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
);
