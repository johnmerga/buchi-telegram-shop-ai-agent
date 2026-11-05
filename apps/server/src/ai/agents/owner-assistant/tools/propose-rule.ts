import { deliverySettingsSchema } from '@buchi/shared';
import { z } from 'zod';
import type { CatalogService } from '../../../../modules/catalog/catalog.service';
import type { DeliveryService } from '../../../../modules/delivery/delivery.service';
import {
  matchesPromotion,
  pausePreview,
  promotionPreview,
  resolveRule,
  settingsPreview,
  type ResolvedRule,
} from '../../../../modules/rules/rules.domain';
import { ruleProposalSchema } from '../../../../modules/rules/rules.schemas';
import type { OwnerRulesService } from '../../../../modules/rules/rules.service';
import { AppError } from '../../../../shared/errors';
import { approvedActionOf, type ApprovedAction } from '../../../approvals/owner-approvals.service';
import { defineTool, type Tool } from '../../../tool';

export interface ProposeRuleDeps {
  rules: Pick<OwnerRulesService, 'record'>;
  delivery: Pick<DeliveryService, 'savedSettings' | 'saveSettings'>;
  catalog: Pick<CatalogService, 'listProducts'>;
  now: () => Date;
}

/**
 * `owner_confirms`: the registry holds the proposal, the owner sees its preview, and this handler
 * saves the rule only after **Confirm**. A settings change is saved through the delivery settings,
 * which check the whole result.
 */
export function proposeRuleTool(deps: ProposeRuleDeps): Tool {
  return defineTool({
    name: 'propose_rule',
    description:
      "Prepares a rule from the owner's command: a delivery pause, a promotion on fixed-price " +
      'products, or a delivery settings change. The owner sees a preview and confirms it.',
    agents: ['owner_assistant'],
    autonomy: 'owner_confirms',
    input: ruleProposalSchema,
    handle: async (proposal, context) => {
      if (context.actor.kind !== 'owner') {
        throw new AppError('FORBIDDEN', 'Only an owner can confirm a rule.');
      }
      const rule = resolveRule(proposal, deps.now());
      if (rule.type === 'delivery_settings') await saveSettings(deps, context.shopId, rule);
      const ruleId = await deps.rules.record(context.shopId, rule, context.actor.telegramUserId);
      return { status: 'ok', output: { ruleId, type: rule.type } };
    },
  });
}

async function saveSettings(
  deps: ProposeRuleDeps,
  shopId: string,
  rule: Extract<ResolvedRule, { type: 'delivery_settings' }>,
): Promise<void> {
  const { settings } = await deps.delivery.savedSettings(shopId);
  const merged = deliverySettingsSchema.safeParse({ ...settings, ...rule.parameters });
  if (!merged.success) {
    throw new AppError(
      'VALIDATION_FAILED',
      `These delivery settings do not fit together:\n${z.prettifyError(merged.error)}`,
    );
  }
  await deps.delivery.saveSettings(shopId, merged.data);
}

/** The owner's approval of `propose_rule` saves the rule; its preview shows what it will do. */
export function proposeRuleApproval(tool: Tool, deps: ProposeRuleDeps): ApprovedAction {
  return {
    ...approvedActionOf(tool),
    preview: (shopId, proposed) => preview(deps, shopId, proposed),
  };
}

async function preview(
  deps: ProposeRuleDeps,
  shopId: string,
  proposed: Record<string, unknown>,
): Promise<string> {
  let rule: ResolvedRule;
  try {
    rule = resolveRule(ruleProposalSchema.parse(proposed), deps.now());
  } catch (err) {
    if (err instanceof AppError) return `⚠️ This rule cannot be saved: ${err.message}`;
    throw err;
  }
  switch (rule.type) {
    case 'delivery_pause':
      return pausePreview(rule);
    case 'promotion': {
      const products = await deps.catalog.listProducts(shopId);
      const titles = products
        .filter((product) => product.active && matchesPromotion(product, rule.parameters))
        .map((product) => product.title);
      return promotionPreview(rule, titles);
    }
    case 'delivery_settings': {
      const { settings } = await deps.delivery.savedSettings(shopId);
      return settingsPreview(settings ?? undefined, rule.parameters);
    }
  }
}
