import type { LanguageModel } from '@buchi/server/ai/language-model';
import type { Database } from '@buchi/server/db/client';
import { agentDecisions, ownerRules } from '@buchi/server/db/schema';
import { withShop } from '@buchi/server/db/with-shop';
import { resolveRule, type ResolvedRule } from '@buchi/server/modules/rules/rules.domain';
import { ruleProposalSchema } from '@buchi/server/modules/rules/rules.schemas';
import { z } from 'zod';
import { defineSuite, type Suite } from '../harness/suite';
import { createOwnerShop } from './owner-shop';

/** Thursday 5 November 2026, 17:00 in Addis Ababa. */
const NOW = new Date('2026-11-05T14:00:00Z');
const OWNER = { telegramUserId: 1 };

const input = z.strictObject({ message: z.string().min(1) });

const expected = z.strictObject({
  type: z.enum(['delivery_pause', 'promotion', 'delivery_settings']),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
  percentOff: z.number().int().optional(),
  /** Words the promotion must match, among others the agent may add. */
  keywords: z.array(z.string()).optional(),
  settings: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
});
type Expected = z.output<typeof expected>;

interface Actual {
  /** The rule the owner would confirm, with exact times, or null when nothing was proposed. */
  rule: ResolvedRule | null;
  /** Rules saved without the owner's Confirm. Always zero for a correct system. */
  savedWithoutConfirm: number;
}

/**
 * Measures the owner assistant on commands: each one becomes the right structured rule, with
 * Ethiopian-clock times converted by code, and waits for the owner instead of taking effect.
 */
export function ownerCommandsSuite(db: Database): Suite {
  async function run({ message }: z.output<typeof input>, model: LanguageModel): Promise<Actual> {
    const shop = createOwnerShop(db, model, () => NOW);
    const shopId = await shop.shops.create(OWNER.telegramUserId, { name: 'Evaluation shop' });
    await shop.assistant.answer(shopId, OWNER, message);
    const [held, saved] = await withShop(
      db,
      shopId,
      async (tx) =>
        [await tx.select().from(agentDecisions), await tx.select().from(ownerRules)] as const,
    );
    const proposal = held.find((decision) => decision.tool === 'propose_rule')?.proposed;
    const parsed = ruleProposalSchema.safeParse(proposal);
    return {
      rule: parsed.success ? resolveRule(parsed.data, NOW) : null,
      savedWithoutConfirm: saved.length,
    };
  }

  return defineSuite({
    name: 'owner-commands',
    dataset: 'owner-commands.jsonl',
    input,
    expected,
    metrics: { ruleMatch: { atLeast: 1 }, savedWithoutConfirm: { atMost: 0 } },
    run,
    score: (actual, { expected: wanted }) => ({
      ruleMatch: actual.rule && matches(actual.rule, wanted) ? 1 : 0,
      savedWithoutConfirm: actual.savedWithoutConfirm,
    }),
  });
}

function matches(rule: ResolvedRule, wanted: Expected): boolean {
  if (rule.type !== wanted.type) return false;
  if (wanted.startsAt && rule.startsAt.toISOString() !== new Date(wanted.startsAt).toISOString()) {
    return false;
  }
  if (wanted.endsAt && rule.endsAt?.toISOString() !== new Date(wanted.endsAt).toISOString()) {
    return false;
  }
  if (rule.type === 'promotion') {
    const words = rule.parameters.keywords.map((word) => word.toLowerCase());
    return (
      rule.parameters.percentOff === wanted.percentOff &&
      (wanted.keywords ?? []).every((word) => words.includes(word))
    );
  }
  if (rule.type === 'delivery_settings') {
    return JSON.stringify(rule.parameters) === JSON.stringify(wanted.settings);
  }
  return true;
}
