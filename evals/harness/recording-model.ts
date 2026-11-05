import type {
  GenerateRequest,
  GenerateResult,
  LanguageModel,
} from '@buchi/server/ai/language-model';
import type { RecordingStore } from './recording-store';
import { hashRequestKey, requestKey } from './request-hash';

/** Calls the real model and saves each response under its request hash for later replay. */
export class RecordingModel implements LanguageModel {
  constructor(
    private readonly live: LanguageModel,
    private readonly store: RecordingStore,
  ) {}

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const key = requestKey(request);
    const result = await this.live.generate(request);
    await this.store.write(hashRequestKey(key), key, result);
    return result;
  }

  /** Replay cannot serve embeddings, so recording refuses them instead of a run that cannot replay. */
  embed(): Promise<number[]> {
    return Promise.reject(new Error('Evaluations do not record embeddings'));
  }
}
