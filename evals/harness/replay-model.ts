import type {
  GenerateRequest,
  GenerateResult,
  LanguageModel,
} from '@buchi/server/ai/language-model';
import type { RecordingStore } from './recording-store';
import { hashRequestKey, requestKey } from './request-hash';

/** Serves recorded responses and nothing else, so a replay run can never reach the network. */
export class ReplayModel implements LanguageModel {
  constructor(private readonly store: RecordingStore) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const hash = hashRequestKey(requestKey(request));
    const result = await this.store.read(hash);
    if (!result) {
      throw new Error(
        `No recording for model request ${hash} in ${this.store.dir}. The dataset, prompt, or ` +
          'tools changed since the suite was recorded. Run `pnpm evals:record` with ' +
          'GEMINI_API_KEY set, and commit the new recordings.',
      );
    }
    return result;
  }

  embed(): Promise<number[]> {
    return Promise.reject(new Error('Evaluations do not record embeddings'));
  }
}
