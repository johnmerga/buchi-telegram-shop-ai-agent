import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import type { Scores } from './gate';

const baselineSchema = z.record(z.string(), z.record(z.string(), z.number()));

/** The scores of the last release. A run fails when a metric gets worse than its baseline. */
export async function readBaseline(path: string): Promise<Scores> {
  const parsed = baselineSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
  if (!parsed.success) {
    throw new Error(`Baseline ${path} is invalid:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export async function writeBaseline(path: string, scores: Scores): Promise<void> {
  await writeFile(path, `${JSON.stringify(scores, null, 2)}\n`);
}
