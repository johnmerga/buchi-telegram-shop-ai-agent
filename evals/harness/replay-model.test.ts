import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  GenerateRequest,
  GenerateResult,
  LanguageModel,
} from '@buchi/server/ai/language-model';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingModel } from './recording-model';
import { RecordingStore } from './recording-store';
import { ReplayModel } from './replay-model';
import { hashRequestKey, requestKey } from './request-hash';

const ask = (text: string): GenerateRequest => ({
  tier: 'fast',
  priority: 'customer',
  contents: [{ role: 'user', parts: [{ text }] }],
});

const reply = (text: string): GenerateResult => ({
  content: { role: 'model', parts: [{ text, thoughtSignature: 'c2lnbmF0dXJl' }] },
  text,
  functionCalls: [],
  usage: { inputTokens: 12, outputTokens: 3 },
});

const functionCall = { id: 'call-1', name: 'offer_price', args: { price: '900.00' } };
const toolCall: GenerateResult = {
  content: { role: 'model', parts: [{ functionCall }] },
  text: undefined,
  functionCalls: [functionCall],
  usage: { inputTokens: 20, outputTokens: 5 },
};

let dir = '';
let store: RecordingStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'buchi-recordings-'));
  store = new RecordingStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function liveModel(results: Map<string, GenerateResult>): LanguageModel {
  return {
    generate: vi.fn((request: GenerateRequest) => {
      const text = request.contents[0]?.parts?.[0]?.text ?? '';
      const result = results.get(text);
      return result ? Promise.resolve(result) : Promise.reject(new Error(`Unexpected ${text}`));
    }),
    embed: vi.fn(),
  };
}

describe('recording and replay', () => {
  it('replays exactly what the live model answered, matched by request', async () => {
    const live = liveModel(
      new Map([
        ['hello', reply('ሰላም')],
        ['900?', toolCall],
      ]),
    );
    const recorder = new RecordingModel(live, store);
    await recorder.generate(ask('hello'));
    await recorder.generate(ask('900?'));

    const replay = new ReplayModel(store);
    expect(await replay.generate({ ...ask('900?'), priority: 'owner' })).toEqual(toolCall);
    expect(await replay.generate(ask('hello'))).toEqual(reply('ሰላም'));
    expect(await readdir(dir)).toHaveLength(2);
  });

  it('fails with the request hash and the fix when a recording is missing', async () => {
    const hash = hashRequestKey(requestKey(ask('unrecorded')));

    await expect(new ReplayModel(store).generate(ask('unrecorded'))).rejects.toThrow(
      `No recording for model request ${hash} in ${dir}. The dataset, prompt, or tools changed ` +
        'since the suite was recorded. Run `pnpm evals:record`',
    );
  });

  it('rejects a recording that does not match the schema, naming the file', async () => {
    const hash = hashRequestKey(requestKey(ask('hello')));
    const recording = {
      request: {},
      result: { ...reply('hi'), content: { parts: [{ image: 'x' }] } },
    };
    await writeFile(join(dir, `${hash}.json`), JSON.stringify(recording));

    await expect(new ReplayModel(store).generate(ask('hello'))).rejects.toThrow(
      `Recording ${join(dir, `${hash}.json`)} is invalid`,
    );
  });

  it('starts a new recording from an empty folder', async () => {
    await new RecordingModel(liveModel(new Map([['hello', reply('hi')]])), store).generate(
      ask('hello'),
    );
    await store.clear();

    expect(await store.read(hashRequestKey(requestKey(ask('hello'))))).toBeUndefined();
  });
});
