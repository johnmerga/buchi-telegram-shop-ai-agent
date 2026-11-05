import type { Logger } from 'pino';
import type { ReportingService } from '../../../modules/reporting/reporting.service';
import type { OwnerAlerts } from '../../../modules/owner/owner-alerts.service';
import { ruleProposalSchema } from '../../../modules/rules/rules.schemas';
import type { OwnerApprovals } from '../../approvals/owner-approvals.service';
import type { PolicyGuard } from '../../guard/policy-guard.service';
import { weeklySuggestionsPrompt } from '../../prompts/weekly-suggestions';
import type { AgentDefinition, AgentRuntime, RunResult } from '../../runtime';
import { failureOf } from '../../structured-output';
import { todayLine } from './owner-answer.domain';
import { parseSuggestions, unsupportedNumbers, type Suggestion } from './suggestions.domain';

/** Weighing numbers needs judgment; owner work waits behind customers when quota is short. */
const weeklyAgent: AgentDefinition = {
  name: 'owner_assistant',
  prompt: weeklySuggestionsPrompt,
  tier: 'smart',
  priority: 'owner',
};

// A type alias, not an interface, so it fits the jobs' `Record<string, number>` summary type.
type WeeklySummary = { shops: number; suggestions: number; dropped: number };

/**
 * The `weekly-suggestions` job, which cron-job.org calls on Mondays at 9:00 in Addis Ababa. For
 * each shop with recent orders, the owner assistant runs the fixed analysis and suggests up to
 * three changes. Code drops a suggestion with a number the analysis did not return, or a rule
 * that does not parse; each one left reaches the owners as a rule preview to confirm. A shop's
 * week is claimed first, so a second call the same week sends nothing.
 */
export class WeeklySuggestions {
  constructor(
    private readonly runtime: Pick<AgentRuntime, 'run'>,
    private readonly reporting: Pick<ReportingService, 'shopsForWeeklySuggestions' | 'claimWeek'>,
    private readonly guard: Pick<PolicyGuard, 'requestOwnerConfirmation'>,
    private readonly approvals: Pick<OwnerApprovals, 'requestFor'>,
    private readonly alerts: Pick<OwnerAlerts, 'send'>,
    private readonly logger: Logger,
    private readonly now: () => Date,
  ) {}

  async run(): Promise<WeeklySummary> {
    const summary: WeeklySummary = { shops: 0, suggestions: 0, dropped: 0 };
    for (const shopId of await this.reporting.shopsForWeeklySuggestions()) {
      if (!(await this.reporting.claimWeek(shopId))) continue;
      const sent = await this.runShop(shopId);
      summary.shops += 1;
      summary.suggestions += sent.suggestions;
      summary.dropped += sent.dropped;
    }
    this.logger.info(summary, 'weekly suggestions finished');
    return summary;
  }

  private async runShop(shopId: string): Promise<{ suggestions: number; dropped: number }> {
    let result: RunResult;
    try {
      result = await this.runtime.run(weeklyAgent, {
        shopId,
        actor: { kind: 'system' },
        history: [{ role: 'user', parts: [{ text: todayLine(this.now()) }] }],
      });
    } catch (err) {
      this.logger.warn({ shopId, failure: failureOf(err) }, 'weekly suggestions unavailable');
      return { suggestions: 0, dropped: 0 };
    }
    if (result.outcome !== 'reply') return { suggestions: 0, dropped: 0 };

    const proposed = parseSuggestions(result.text) ?? [];
    const findings = JSON.stringify(result.toolResults.filter((r) => r.status === 'ok'));
    const kept = proposed.filter((suggestion) => this.supported(shopId, suggestion, findings));
    if (kept.length > 0) await this.send(shopId, result.runId, kept);
    return { suggestions: kept.length, dropped: proposed.length - kept.length };
  }

  private supported(shopId: string, suggestion: Suggestion, findings: string): boolean {
    const unsupported = unsupportedNumbers(suggestion.text, findings);
    const ruleParses = ruleProposalSchema.safeParse(suggestion.rule).success;
    if (unsupported.length === 0 && ruleParses) return true;
    this.logger.warn({ shopId, unsupported, ruleParses }, 'weekly suggestion dropped');
    return false;
  }

  /** The list first, then one preview per suggestion in the same order, from the held rules. */
  private async send(shopId: string, runId: string, suggestions: Suggestion[]): Promise<void> {
    const context = {
      shopId,
      runId,
      agent: weeklyAgent.name,
      tool: 'propose_rule',
      actor: { kind: 'system' as const },
    };
    for (const suggestion of suggestions) {
      await this.guard.requestOwnerConfirmation(context, ruleProposalSchema.parse(suggestion.rule));
    }
    const list = suggestions.map((suggestion, index) => `${String(index + 1)}. ${suggestion.text}`);
    await this.alerts.send(
      shopId,
      ['💡 የሳምንቱ ምክሮች / This week’s suggestions', ...list, 'Each one follows as a preview.'].join(
        '\n',
      ),
    );
    await this.approvals.requestFor(shopId, runId);
  }
}
