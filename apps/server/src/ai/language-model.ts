import type { Content, FunctionCall, FunctionDeclaration } from '@google/genai';

/** Flash-Lite answers simple, frequent requests; Flash handles judgment, vision, and SQL. */
export type ModelTier = 'fast' | 'smart';

/** From most to least important. When quota runs low, the last ones stop first. */
export type Priority = 'payment' | 'customer' | 'operations' | 'owner';

export interface GenerateRequest {
  tier: ModelTier;
  priority: Priority;
  systemInstruction?: string;
  contents: Content[];
  tools?: FunctionDeclaration[];
  /** When set, the model must answer with JSON that matches this schema. */
  responseJsonSchema?: Record<string, unknown>;
}

export interface GenerateResult {
  /** The model's turn as returned. Agents send it back unchanged, with its thought signatures. */
  content: Content;
  text: string | undefined;
  functionCalls: FunctionCall[];
  usage: { inputTokens: number; outputTokens: number };
}

/** The model behind every agent. Gemini is the only implementation; tests use a fake. */
export interface LanguageModel {
  generate(request: GenerateRequest): Promise<GenerateResult>;
  embed(text: string, priority: Priority): Promise<number[]>;
}
