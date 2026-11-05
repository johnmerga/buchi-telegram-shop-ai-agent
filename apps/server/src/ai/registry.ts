import type { AgentName } from '@buchi/shared';
import type { FunctionCall, FunctionDeclaration } from '@google/genai';
import type { Logger } from 'pino';
import { AppError } from '../shared/errors';
import type { PolicyGuard } from './guard/policy-guard.service';
import type { RunContext, Tool, ToolActor, ToolResult } from './tool';

/**
 * Every tool an agent can use. Each agent sees and runs only its own tools, so a customer message
 * that makes the model name an owner tool still cannot reach it.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(
    tools: readonly Tool[],
    private readonly guard: Pick<PolicyGuard, 'requestOwnerConfirmation'>,
    private readonly logger: Logger,
  ) {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) throw new Error(`Tool ${tool.name} is registered twice`);
      this.tools.set(tool.name, tool);
    }
  }

  declarationsFor(agent: AgentName): FunctionDeclaration[] {
    return [...this.tools.values()]
      .filter((tool) => tool.agents.includes(agent))
      .map((tool) => tool.declaration);
  }

  /** Runs one function call from the model. Every failure becomes a result the model can read. */
  async execute(call: FunctionCall, context: RunContext): Promise<ToolResult> {
    const name = call.name ?? '';
    const tool = this.tools.get(name);
    if (!tool?.agents.includes(context.agent)) {
      this.logger.warn({ agent: context.agent, tool: name }, 'model called a tool outside its set');
      // The same answer as for a tool that does not exist, so the model learns nothing about others.
      return { status: 'error', error: `There is no tool named "${name}".` };
    }

    const parsed = tool.parse(call.args ?? {});
    if (!parsed.success) return { status: 'error', error: `Invalid arguments:\n${parsed.error}` };
    if (!withinSituation(parsed.input, context.actor)) {
      return { status: 'error', error: 'You can act only on the records of this situation.' };
    }

    const callContext = { ...context, tool: tool.name };
    try {
      if (tool.autonomy === 'owner_confirms') {
        return await this.guard.requestOwnerConfirmation(callContext, parsed.input);
      }
      return await parsed.run(callContext);
    } catch (err) {
      if (err instanceof AppError) return { status: 'error', error: err.message };
      this.logger.error({ err, agent: context.agent, tool: tool.name }, 'tool failed');
      return { status: 'error', error: 'The tool failed for an internal reason.' };
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A message in the situation, such as a customer's text, may try to steer the agent to another
 * order. Every ID in a situation run's arguments must be one that code put in the situation.
 */
function withinSituation(input: Record<string, unknown>, actor: ToolActor): boolean {
  if (actor.kind !== 'situation') return true;
  return Object.values(input).every(
    (value) => typeof value !== 'string' || !UUID.test(value) || actor.recordIds.includes(value),
  );
}
