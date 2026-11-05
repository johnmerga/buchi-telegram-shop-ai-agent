import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GenerateResult } from '@buchi/server/ai/language-model';
import { z } from 'zod';
import type { RequestKey } from './request-hash';

/*
 * Strict schemas, so a recording with a part this harness does not know (an image, code
 * execution) fails loudly instead of replaying a turn that differs from what the model said.
 */
const functionCallSchema = z.strictObject({
  id: z.string().exactOptional(),
  name: z.string().exactOptional(),
  args: z.record(z.string(), z.unknown()).exactOptional(),
});

const partSchema = z.strictObject({
  text: z.string().exactOptional(),
  thought: z.boolean().exactOptional(),
  thoughtSignature: z.string().exactOptional(),
  functionCall: functionCallSchema.exactOptional(),
});

const tokenCount = z.number().int().nonnegative();

const recordingSchema = z.strictObject({
  /** Kept for people reading a recording. The file name is its hash. */
  request: z.json(),
  result: z.strictObject({
    content: z.strictObject({
      role: z.string().exactOptional(),
      parts: z.array(partSchema).exactOptional(),
    }),
    text: z.string().optional(),
    functionCalls: z.array(functionCallSchema),
    usage: z.strictObject({ inputTokens: tokenCount, outputTokens: tokenCount }),
  }),
});

/** One suite's recorded model responses: one JSON file per request, named by the request hash. */
export class RecordingStore {
  constructor(readonly dir: string) {}

  async read(hash: string): Promise<GenerateResult | undefined> {
    const path = this.pathOf(hash);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      if (isMissingFile(err)) return undefined;
      throw err;
    }
    const parsed = recordingSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      throw new Error(`Recording ${path} is invalid:\n${z.prettifyError(parsed.error)}`);
    }
    const { result } = parsed.data;
    // JSON drops an undefined `text`, but the result type always has the key.
    return { ...result, text: result.text };
  }

  async write(hash: string, request: RequestKey, result: GenerateResult): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.pathOf(hash), `${JSON.stringify({ request, result }, null, 2)}\n`);
  }

  /** Recording starts from an empty folder, so no response from an older run lingers. */
  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
  }

  private pathOf(hash: string): string {
    return join(this.dir, `${hash}.json`);
  }
}

function isMissingFile(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT';
}
