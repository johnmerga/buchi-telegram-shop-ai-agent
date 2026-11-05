import type { Logger } from 'pino';
import type { ChartRenderer } from '../../../integrations/quickchart';
import { seriesChart, type QueryRows } from '../../../modules/reporting/reporting.domain';
import type { OwnerApprovals } from '../../approvals/owner-approvals.service';
import { ownerAssistantPrompt } from '../../prompts/owner-assistant';
import type { AgentDefinition, AgentRuntime, RunResult } from '../../runtime';
import { failureOf } from '../../structured-output';
import type { ToolResult } from '../../tool';
import { namesUnknownAmount, rowsText, todayLine } from './owner-answer.domain';
import { askDataOutputSchema } from './tools/ask-data';

/** Rules and SQL need care, so the owner assistant uses the smart tier, as the design doc routes it. */
const ownerAssistantAgent: AgentDefinition = {
  name: 'owner_assistant',
  prompt: ownerAssistantPrompt,
  tier: 'smart',
  priority: 'owner',
};

export interface OwnerAnswer {
  text: string;
  /** A PNG chart of the last query, when its result is a series. */
  chart?: Uint8Array;
}

const replies = {
  unavailable: 'ይቅርታ / Sorry, I cannot answer right now. Please try again in a while.',
  escalated: 'ይቅርታ / Sorry, I could not do that. Please say it another way.',
  previewSent: 'I sent a preview above. Tap Confirm to save it.',
};

/**
 * Answers the owner's commands and questions. Commands end as previews that the owner confirms;
 * questions end as rows from one checked query, with a chart for a series. Code keeps the last
 * word: a reply with a figure that no tool gave is replaced by the rows themselves.
 */
export class OwnerAssistant {
  constructor(
    private readonly runtime: Pick<AgentRuntime, 'run'>,
    private readonly approvals: Pick<OwnerApprovals, 'requestFor'>,
    private readonly charts: ChartRenderer,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  async answer(
    shopId: string,
    owner: { telegramUserId: number },
    text: string,
  ): Promise<OwnerAnswer> {
    const today = todayLine(this.now());
    let result: RunResult;
    try {
      result = await this.runtime.run(ownerAssistantAgent, {
        shopId,
        actor: { kind: 'owner', telegramUserId: owner.telegramUserId },
        history: [{ role: 'user', parts: [{ text: today }, { text }] }],
      });
    } catch (err) {
      this.logger.warn({ shopId, failure: failureOf(err) }, 'owner assistant unavailable');
      return { text: replies.unavailable };
    }
    await this.approvals.requestFor(shopId, result.runId);
    if (result.outcome === 'escalated') return { text: replies.escalated };

    const query = lastQuery(result.toolResults);
    const trusted = [today, text, JSON.stringify(result.toolResults)];
    const reply = namesUnknownAmount(result.text, trusted)
      ? this.fallback(shopId, result, query)
      : result.text;
    const chart = query && (await this.chartOf(shopId, query));
    return chart ? { text: reply, chart } : { text: reply };
  }

  private fallback(
    shopId: string,
    result: Extract<RunResult, { outcome: 'reply' }>,
    query: (QueryRows & { title: string }) | undefined,
  ): string {
    this.logger.warn({ shopId, runId: result.runId }, 'owner reply named a figure no tool gave');
    if (query) return `${query.title}\n${rowsText(query)}`;
    const held = result.toolResults.some((toolResult) => toolResult.status === 'awaiting_owner');
    return held ? replies.previewSent : replies.escalated;
  }

  /** QuickChart is optional: without it the owner still has the answer as text. */
  private async chartOf(
    shopId: string,
    query: QueryRows & { title: string },
  ): Promise<Uint8Array | undefined> {
    const chart = seriesChart(query, query.title);
    if (!chart) return undefined;
    try {
      return await this.charts.render(chart);
    } catch (err) {
      this.logger.warn(
        { shopId, failure: err instanceof Error ? err.message : 'unknown' },
        'chart failed',
      );
      return undefined;
    }
  }
}

/** The result of the run's last successful `ask_data` call. */
function lastQuery(results: ToolResult[]): (QueryRows & { title: string }) | undefined {
  return results
    .flatMap((result) => {
      if (result.status !== 'ok') return [];
      const parsed = askDataOutputSchema.safeParse(result.output);
      return parsed.success ? [parsed.data] : [];
    })
    .at(-1);
}
