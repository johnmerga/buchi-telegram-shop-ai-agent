import { readFile } from 'node:fs/promises';
import type { DatasetRow } from './suite';

/** Reads a JSONL dataset. Blank lines are skipped, and errors name the file and line. */
export async function readDataset(path: string): Promise<DatasetRow[]> {
  const lines = (await readFile(path, 'utf8')).split('\n');
  const rows: DatasetRow[] = [];
  for (const [index, text] of lines.entries()) {
    if (text.trim() === '') continue;
    const line = index + 1;
    try {
      rows.push({ line, value: JSON.parse(text) });
    } catch (err) {
      throw new Error(`${path}:${String(line)} is not valid JSON`, { cause: err });
    }
  }
  return rows;
}
