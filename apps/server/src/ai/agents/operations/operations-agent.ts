import type { Logger } from 'pino';
import type { OwnerAlerts } from '../../../modules/owner/owner-alerts.service';
import type { OwnerApprovals } from '../../approvals/owner-approvals.service';
import { operationsPrompt } from '../../prompts/operations';
import type { AgentDefinition, AgentRuntime, RunResult } from '../../runtime';
import { failureOf } from '../../structured-output';
import { recordIdsOf, situationHeadline, situationText, type Situation } from './situation.domain';

/** Operations needs judgment about people and money, so it uses the smart tier. */
const operationsAgent: AgentDefinition = {
  name: 'operations',
  prompt: operationsPrompt,
  tier: 'smart',
  priority: 'operations',
};

/** `idle` means the agent decided that the situation needs nothing from it. */
export type OperationsOutcome = 'acted' | 'idle' | 'handed_to_owner';

/**
 * Runs the operations agent on one situation. Tools do all the talking, and the policy guard and
 * the registry apply the autonomy levels. Held decisions go to the owners with buttons, and a run
 * that fails or gives up goes to the owners as an alert, because failures go to the owner.
 */
export class OperationsAgent {
  constructor(
    private readonly runtime: Pick<AgentRuntime, 'run'>,
    private readonly approvals: Pick<OwnerApprovals, 'requestFor'>,
    private readonly alerts: Pick<OwnerAlerts, 'send'>,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  async handle(situation: Situation): Promise<OperationsOutcome> {
    const { shopId } = situation;
    let result: RunResult;
    try {
      result = await this.runtime.run(operationsAgent, {
        shopId,
        actor: { kind: 'situation', recordIds: recordIdsOf(situation) },
        history: [{ role: 'user', parts: [{ text: situationText(situation, this.now()) }] }],
      });
    } catch (err) {
      this.logger.warn({ shopId, failure: failureOf(err) }, 'operations agent unavailable');
      return this.handOver(situation);
    }

    await this.approvals.requestFor(shopId, result.runId);
    if (result.outcome === 'escalated') return this.handOver(situation);
    const acted = result.toolResults.some(
      (toolResult) => toolResult.status === 'ok' || toolResult.status === 'awaiting_owner',
    );
    return acted ? 'acted' : 'idle';
  }

  private async handOver(situation: Situation): Promise<OperationsOutcome> {
    await this.alerts.send(
      situation.shopId,
      `⚠️ Buchi could not handle this, please check: ${situationHeadline(situation)}`,
    );
    return 'handed_to_owner';
  }
}
