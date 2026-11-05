import { randomUUID } from 'node:crypto';
import type { AgentName } from '@buchi/shared';
import type { Content, FunctionCall, FunctionDeclaration, Part } from '@google/genai';
import type { Database } from '../db/client';
import { withShop } from '../db/with-shop';
import type { GenerateResult, LanguageModel, ModelTier, Priority } from './language-model';
import type { Prompt } from './prompts/prompt';
import type { ToolRegistry } from './registry';
import type { RunContext, ToolActor, ToolResult } from './tool';
import type { NewTrace, TracesRepo } from './traces.repo';

export interface AgentDefinition {
  name: AgentName;
  prompt: Prompt;
  tier: ModelTier;
  priority: Priority;
}

export interface RunRequest {
  shopId: string;
  actor: ToolActor;
  /** The conversation so far, ending with the turn the agent should answer. */
  history: Content[];
}

type EscalationReason = 'guard_rejections' | 'step_limit' | 'empty_reply';

/** A reply comes with every tool result of the run, so callers can check the reply against them. */
export type RunResult = { runId: string } & (
  | { outcome: 'reply'; text: string; toolResults: ToolResult[] }
  | { outcome: 'escalated'; reason: EscalationReason }
);

/** Enough for a lookup, a check, and a reply, with room for one retry after a rejection. */
const MAX_STEPS = 6;
/** The design doc's rule: after two guard rejections, the case goes to the owner. */
const MAX_REJECTIONS = 2;

type TraceFields = Pick<NewTrace, 'step' | 'toolCalls' | 'latencyMs' | 'outcome'> & {
  usage: GenerateResult['usage'];
};

/** The one agent loop: the model proposes tool calls, the registry runs them, and the loop repeats. */
export class AgentRuntime {
  constructor(
    private readonly model: LanguageModel,
    private readonly registry: ToolRegistry,
    private readonly db: Database,
    private readonly traces: TracesRepo,
    /** Milliseconds from a monotonic clock, for model latency. */
    private readonly clock: () => number,
  ) {}

  async run(agent: AgentDefinition, request: RunRequest): Promise<RunResult> {
    const context: RunContext = {
      shopId: request.shopId,
      runId: randomUUID(),
      agent: agent.name,
      actor: request.actor,
    };
    const tools = this.registry.declarationsFor(agent.name);
    const contents = [...request.history];
    const toolResults: ToolResult[] = [];
    let rejections = 0;

    for (let step = 1; step <= MAX_STEPS; step += 1) {
      const { response, latencyMs } = await this.generate(agent, context, step, contents, tools);
      const traced = { step, latencyMs, usage: response.usage };

      if (response.functionCalls.length === 0) {
        const text = response.text?.trim() ?? '';
        const outcome = text ? 'reply' : 'escalated';
        await this.trace(agent, context, { ...traced, toolCalls: [], outcome });
        return text
          ? { runId: context.runId, outcome: 'reply', text, toolResults }
          : { runId: context.runId, outcome: 'escalated', reason: 'empty_reply' };
      }

      const executed = await this.execute(response.functionCalls, context, rejections);
      rejections = executed.rejections;
      toolResults.push(...executed.results);
      const escalated = rejections >= MAX_REJECTIONS;
      await this.trace(agent, context, {
        ...traced,
        toolCalls: executed.toolCalls,
        outcome: escalated || step === MAX_STEPS ? 'escalated' : 'tool_calls',
      });
      if (escalated) {
        return { runId: context.runId, outcome: 'escalated', reason: 'guard_rejections' };
      }
      contents.push(response.content, { role: 'user', parts: executed.responses });
    }
    return { runId: context.runId, outcome: 'escalated', reason: 'step_limit' };
  }

  /** Runs the calls in order and stops at the rejection that escalates, so nothing runs after it. */
  private async execute(calls: FunctionCall[], context: RunContext, rejectionsBefore: number) {
    const toolCalls: NewTrace['toolCalls'] = [];
    const responses: Part[] = [];
    const results: ToolResult[] = [];
    let rejections = rejectionsBefore;
    for (const call of calls) {
      if (rejections >= MAX_REJECTIONS) break;
      const name = call.name ?? '';
      const result = await this.registry.execute(call, context);
      results.push(result);
      toolCalls.push({ name, args: call.args ?? {}, status: result.status });
      responses.push({
        functionResponse: { ...(call.id ? { id: call.id } : {}), name, response: result },
      });
      if (result.status === 'rejected') rejections += 1;
    }
    return { toolCalls, responses, results, rejections };
  }

  /** A failed model call is traced too, so quota and outages show up next to successful calls. */
  private async generate(
    agent: AgentDefinition,
    context: RunContext,
    step: number,
    contents: Content[],
    tools: FunctionDeclaration[],
  ): Promise<{ response: GenerateResult; latencyMs: number }> {
    const started = this.clock();
    try {
      const response = await this.model.generate({
        tier: agent.tier,
        priority: agent.priority,
        systemInstruction: agent.prompt.text,
        contents,
        ...(tools.length > 0 ? { tools } : {}),
      });
      return { response, latencyMs: this.elapsedSince(started) };
    } catch (err) {
      await this.trace(agent, context, {
        step,
        toolCalls: [],
        latencyMs: this.elapsedSince(started),
        usage: { inputTokens: 0, outputTokens: 0 },
        outcome: 'failed',
      });
      throw err;
    }
  }

  private elapsedSince(started: number): number {
    return Math.round(this.clock() - started);
  }

  private async trace(agent: AgentDefinition, context: RunContext, fields: TraceFields) {
    const { usage, ...rest } = fields;
    await withShop(this.db, context.shopId, (tx) =>
      this.traces.insert(tx, {
        ...rest,
        shopId: context.shopId,
        runId: context.runId,
        agent: agent.name,
        promptId: agent.prompt.id,
        promptVersion: agent.prompt.version,
        modelTier: agent.tier,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      }),
    );
  }
}
