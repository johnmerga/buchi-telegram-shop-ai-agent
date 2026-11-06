import { describe, expect, it } from 'vitest';
import { orderClosed, reportButton, reportedCaption } from './payment-messages.domain';
import { reportCallbackSchema } from './payments.schemas';

const orderId = '3f2a9c00-0000-4000-8000-000000000001';

describe('reportButton', () => {
  it('carries the order that the report callback schema reads back', () => {
    const button = reportButton(orderId);
    expect(button.text).toContain('Report a problem');
    expect(reportCallbackSchema.parse(button.data)).toEqual({ prefix: 'payreport', orderId });
  });

  it('is not confused with another button', () => {
    expect(reportCallbackSchema.safeParse(`payment:approve:${orderId}`).success).toBe(false);
  });
});

describe('reportedCaption', () => {
  it('shows the reasons, what Buchi read, and the bank page', () => {
    const text = reportedCaption({
      orderId,
      total: '800.00',
      reasons: ['time', 'reused'],
      receipt: { amount: '800.00', provider: 'telebirr', txRef: 'DG92OT8YDE' },
      bank: 'MISMATCH',
    });
    expect(text).toContain('rejected payment for order #3F2A9C · total 800.00 ብር');
    expect(text).toContain(
      'Rejected because the payment was made before this order was placed; this transaction is already used for another order.',
    );
    expect(text).toContain('Screenshot: 800.00 ብር · telebirr · DG92OT8YDE');
    expect(text).toContain('Bank page: details differ');
  });

  it('leaves out what Buchi could not read, and keeps an unknown reason as it is', () => {
    const text = reportedCaption({
      orderId,
      total: '800.00',
      reasons: ['something_new'],
      receipt: undefined,
      bank: null,
    });
    expect(text).toContain('Rejected because something_new.');
    expect(text).not.toContain('Screenshot:');
    expect(text).not.toContain('Bank page');
  });
});

describe('orderClosed', () => {
  it('says the order takes no more screenshots', () => {
    expect(orderClosed(orderId)).toContain(
      'order #3F2A9C was not accepted, so this order is closed',
    );
  });
});
