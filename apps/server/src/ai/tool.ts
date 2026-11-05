import type { AgentName, AutonomyLevel } from '@buchi/shared';
import type { FunctionDeclaration } from '@google/genai';
import { z } from 'zod';

/**
 * Who an agent acts for. Code resolves it from the Telegram user ID, never from message text. An
 * operations run acts on one situation, and may touch only the records that its situation names.
 * An owner approves a held action, which then runs for them.
 */
export type ToolActor =
  | { kind: 'telegram_user'; telegramUserId: number }
  | { kind: 'situation'; recordIds: readonly string[] }
  | { kind: 'owner'; telegramUserId: number }
  | { kind: 'system' };

/** One agent run for one shop. */
export interface RunContext {
  shopId: string;
  runId: string;
  agent: AgentName;
  actor: ToolActor;
}

/** A run context for one tool call, so that each recorded decision names its tool. */
export interface ToolCallContext extends RunContext {
  tool: string;
}

/** What the model reads after a tool call. Private limits never appear here. */
export type ToolResult =
  | { status: 'ok'; output: Record<string, unknown> }
  | { status: 'rejected'; reason: string; counteroffer: string | number }
  | { status: 'awaiting_owner' }
  | { status: 'error'; error: string };

export interface ToolDefinition<Input extends z.ZodObject> {
  name: string;
  description: string;
  agents: readonly AgentName[];
  autonomy: AutonomyLevel;
  input: Input;
  /** For an `owner_confirms` tool, this runs only after the owner approves the request. */
  handle(input: z.output<Input>, context: ToolCallContext): Promise<ToolResult>;
}

type ParsedToolCall =
  | {
      success: true;
      input: Record<string, unknown>;
      run: (context: ToolCallContext) => Promise<ToolResult>;
    }
  | { success: false; error: string };

/** A tool with its input type hidden, so tools with different inputs share one registry. */
export interface Tool {
  name: string;
  agents: readonly AgentName[];
  autonomy: AutonomyLevel;
  declaration: FunctionDeclaration;
  /** Model arguments are untrusted input, so every call is parsed before anything runs. */
  parse(args: unknown): ParsedToolCall;
}

export function defineTool<Input extends z.ZodObject>(definition: ToolDefinition<Input>): Tool {
  const { name, description, agents, autonomy, input: schema } = definition;
  return {
    name,
    agents,
    autonomy,
    declaration: { name, description, parametersJsonSchema: parametersOf(schema) },
    parse(args) {
      const parsed = schema.safeParse(args);
      if (!parsed.success) return { success: false, error: z.prettifyError(parsed.error) };
      const input = parsed.data;
      return { success: true, input, run: (context) => definition.handle(input, context) };
    },
  };
}

function parametersOf(schema: z.ZodObject): Record<string, unknown> {
  // The model writes the input, so defaulted fields are optional for it.
  const parameters = z.toJSONSchema(schema, { io: 'input' });
  // Gemini accepts a subset of JSON Schema, and the dialect URI is not part of it.
  delete parameters.$schema;
  return parameters;
}
