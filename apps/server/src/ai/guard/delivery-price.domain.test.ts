import { Money } from '@buchi/shared';
import { describe, expect, it } from 'vitest';
import { checkDeliveryPrice } from './delivery-price.domain';

const limits = { formulaPayout: Money.of('300'), cap: Money.of('1000') };

describe('checkDeliveryPrice', () => {
  it.each(['300', '480', '1000'])(
    'accepts %s birr between the formula payout and the cap',
    (price) => {
      expect(checkDeliveryPrice(Money.of(price), limits)).toEqual({
        result: 'accepted',
        reason: 'within_limits',
        value: Money.of(price),
      });
    },
  );

  it('rejects a price below the formula payout with the payout as the counteroffer', () => {
    expect(checkDeliveryPrice(Money.of('299.99'), limits)).toEqual({
      result: 'rejected',
      reason: 'below_formula_payout',
      counteroffer: Money.of('300'),
    });
  });

  it('sends a price above the cap to the owner', () => {
    expect(checkDeliveryPrice(Money.of('1000.01'), limits)).toEqual({
      result: 'needs_owner',
      reason: 'above_cap',
    });
  });

  it('sends every price to the owner when the payout is above the cap', () => {
    const inverted = { formulaPayout: Money.of('1200'), cap: Money.of('1000') };
    expect(checkDeliveryPrice(Money.of('1200'), inverted).result).toBe('needs_owner');
  });
});
