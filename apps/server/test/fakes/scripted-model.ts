import type { Content, FunctionCall } from '@google/genai';
import type { GenerateRequest, GenerateResult, LanguageModel } from '../../src/ai/language-model';

/** One scripted model turn: a text reply, function calls, or a failure. */
export type ScriptedTurn = { text: string } | { calls: FunctionCall[] } | { error: Error };

/**
 * A `LanguageModel` that plays back scripted turns in order and keeps a copy of every request, so
 * tests can check what the model was shown.
 */
export class ScriptedModel implements LanguageModel {
  readonly requests: GenerateRequest[] = [];

  constructor(private readonly turns: ScriptedTurn[]) {}

  generate(request: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(structuredClone(request));
    const turn = this.turns.shift();
    if (!turn) return Promise.reject(new Error('The script has no more turns'));
    if ('error' in turn) return Promise.reject(turn.error);

    const usage = { inputTokens: 100, outputTokens: 10 };
    if ('text' in turn) {
      return Promise.resolve({
        content: modelTurn([{ text: turn.text }]),
        text: turn.text,
        functionCalls: [],
        usage,
      });
    }
    const content = modelTurn(turn.calls.map((functionCall) => ({ functionCall })));
    return Promise.resolve({ content, text: undefined, functionCalls: turn.calls, usage });
  }

  embed(): Promise<number[]> {
    return Promise.reject(new Error('Embeddings are not scripted'));
  }
}

function modelTurn(parts: NonNullable<Content['parts']>): Content {
  return { role: 'model', parts };
}
