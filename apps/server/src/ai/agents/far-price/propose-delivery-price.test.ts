import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { checkDeliveryPrice } from '../../guard/delivery-price.domain';
import type { PolicyGuard } from '../../guard/policy-guard.service';
import { toToolResult } from '../../guard/decision';
import { proposeDeliveryPriceTool, type ProposedPrice } from './propose-delivery-price';

const context = {
  shopId: 's1',
  runId: 'r1',
  agent: 'operations' as const,
  actor: { kind: 'system' as const },
  tool: 'propose_delivery_price',
};
const limits = { formulaPayout: Money.of('300'), cap: Money.of('1000'), approximateRoute: false };

/** The real checker, without the database that records its decisions. */
const guard: Pick<PolicyGuard, 'checkDeliveryPrice'> = {
  checkDeliveryPrice: (_context, proposal, checked) => {
    const decision = checkDeliveryPrice(proposal.value, checked);
    const toolResult = toToolResult(decision, (amount: Money) => amount.toString());
    return Promise.resolve({ decision, toolResult, decisionId: 'd1' });
  },
};

function setUp() {
  const proposals: ProposedPrice[] = [];
  const tool = proposeDeliveryPriceTool({
    guard,
    limits,
    evidenceIds: ['route', 'formula', 'trip:a1'],
    propose: (proposal) => proposals.push(proposal),
  });
  const call = async (args: unknown) => {
    const parsed = tool.parse(args);
    if (!parsed.success) return { status: 'invalid', error: parsed.error };
    return parsed.run(context);
  };
  return { tool, proposals, call };
}

const args = (price: string) => ({ price, reason: 'Like trip a1', evidenceIds: ['trip:a1'] });

describe('propose_delivery_price', () => {
  it('belongs to the operations agent and runs without the owner', () => {
    const { tool } = setUp();
    expect(tool).toMatchObject({ agents: ['operations'], autonomy: 'automatic' });
  });

  it('proposes a price within the limits', async () => {
    const { proposals, call } = setUp();
    expect(await call(args('480'))).toEqual({ status: 'ok', output: { accepted: '480.00' } });
    expect(proposals).toEqual([
      { price: Money.of('480'), reason: 'Like trip a1', decisionId: 'd1', needsOwner: false },
    ]);
  });

  it('returns the formula payout as the counteroffer for a price below it, and proposes nothing', async () => {
    const { proposals, call } = setUp();
    expect(await call(args('250'))).toEqual({
      status: 'rejected',
      reason: 'below_formula_payout',
      counteroffer: '300.00',
    });
    expect(proposals).toEqual([]);
  });

  it('proposes a price above the cap as one the owner must approve', async () => {
    const { proposals, call } = setUp();
    expect(await call(args('1200'))).toEqual({ status: 'awaiting_owner' });
    expect(proposals[0]?.needsOwner).toBe(true);
  });

  it('counts only the first price that passes', async () => {
    const { proposals, call } = setUp();
    await call(args('480'));
    await expect(call(args('500'))).rejects.toThrow('already proposed');
    expect(proposals).toHaveLength(1);
  });

  it('accepts only evidence IDs of this trip', async () => {
    const { call } = setUp();
    expect(await call({ ...args('480'), evidenceIds: ['trip:other'] })).toMatchObject({
      status: 'invalid',
    });
  });
});
