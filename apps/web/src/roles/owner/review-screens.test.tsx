import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeServer, fakeTelegram, json, renderAt, session } from '../../test/fakes';
import { OwnerApp } from './owner-app';

const shopId = '6f1c2a4e-8b3d-4f5a-9c7e-1d2b3a4c5e6f';
const proofId = '4e5f6a7b-8c9d-4e0f-9a1b-2c3d4e5f6a7b';
const decisionId = '5f6a7b8c-9d0e-4f1a-8b2c-3d4e5f6a7b8c';
const farDecisionId = '6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d';
const shop = {
  id: shopId,
  name: 'Selam Shoes',
  channelChatId: null,
  channelTitle: null,
  latitude: null,
  longitude: null,
  createdAt: '2026-11-01T08:00:00.000Z',
  paymentAccounts: [],
};
const paymentDecision = {
  proofId,
  orderReference: '#3D6F0A',
  customerName: 'Hana',
  amount: '3630.00',
  provider: 'telebirr',
  outcome: 'approved',
  decidedBy: 'owner',
  receivedAt: '2026-11-05T09:00:00.000Z',
  bankCheck: 'UNAVAILABLE',
  reasons: ['receiver_unconfirmed'],
};
const field = (value: string | null, confidence = 0.9) => ({ value, confidence });
const review = {
  proofId,
  orderId: '3d6f0a2b-1c4e-4b5a-8d7c-9e0f1a2b3c4d',
  orderReference: '#3D6F0A',
  customerName: 'Hana',
  orderTotal: '3630.00',
  receivedAt: '2026-11-05T09:00:00.000Z',
  extraction: {
    layout: field('telebirr_web'),
    transactionRef: field('CHK12345', 0.88),
    amount: field('3630.00'),
    receiverName: field('Selam Shoes'),
    receiverAccount: field(null, 0),
    payerName: field('Hana'),
    payerAccount: field(null, 0),
    paidAt: field('05-11-2026 12:00:00'),
    status: field('Completed'),
  },
  rules: { r1: 'pass', r3: 'underpaid' },
  bankCheck: 'UNAVAILABLE',
  reasons: ['bank_unavailable'],
  payerHighRisk: true,
  customerReported: true,
};
const decision = {
  agent: 'operations',
  result: 'needs_owner',
  agentReason: null,
  limits: null,
  counteroffer: null,
  evidenceIds: [],
  ownerStatus: 'pending',
  createdAt: '2026-11-05T09:00:00.000Z',
  decidedAt: null,
};
const decisions = [
  {
    ...decision,
    id: decisionId,
    tool: 'propose_bonus',
    reason: 'owner_confirms',
    proposed: { bonus: '50.00' },
    ownerCanDecide: true,
  },
  {
    ...decision,
    id: farDecisionId,
    tool: 'propose_delivery_price',
    reason: 'above_cap',
    proposed: { value: '1400.00' },
    limits: { cap: '1000.00' },
    agentReason: 'Drivers asked 1,400 birr here last week.',
    evidenceIds: ['quote-1'],
    ownerCanDecide: false,
  },
];

/** A live stream that stays open with no events, like a quiet shop. */
const openStream = () => new Response(new ReadableStream(), { status: 200 });

beforeEach(() => {
  fakeTelegram();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:screenshot');
  vi.spyOn(URL, 'revokeObjectURL').mockReturnValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('payment review screen', () => {
  it('shows the screenshot beside what Buchi read, the rules, the bank, risk, and a report', async () => {
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/payment-reviews`]: () => json(200, [review]),
      [`GET /shops/${shopId}/payment-decisions`]: () => json(200, []),
      [`GET /shops/${shopId}/payment-reviews/${proofId}/screenshot`]: () =>
        new Response(new Uint8Array([0xff, 0xd8]), { headers: { 'content-type': 'image/jpeg' } }),
      [`GET /shops/${shopId}/events`]: openStream,
    });
    renderAt(`/shops/${shopId}/payments`, <OwnerApp />);

    const card = await screen.findByRole('region', { name: 'Payment of Hana' });
    expect(card.textContent).toContain('3,630.00 ብር');
    expect(card.textContent).toContain('CHK12345 (88%)');
    expect(card.textContent).toContain('R3 amount: underpaid');
    expect(card.textContent).toContain('UNAVAILABLE');
    expect(card.textContent).toContain('High risk');
    expect(card.textContent).toContain('Reported by the customer');
    const image = await within(card).findByRole('img', { name: 'Payment screenshot' });
    expect(image.getAttribute('src')).toBe('blob:screenshot');
    const screenshot = calls.find((call) => call.key.endsWith('/screenshot'));
    expect(new Headers(screenshot?.init?.headers).get('authorization')).toBe('Bearer test-token');
  });

  it('approves a payment, which moves it from the queue to the recent decisions', async () => {
    let queue = [review];
    let decided: (typeof paymentDecision)[] = [];
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/payment-reviews`]: () => json(200, queue),
      [`GET /shops/${shopId}/payment-decisions`]: () => json(200, decided),
      [`GET /shops/${shopId}/payment-reviews/${proofId}/screenshot`]: () =>
        new Response(new Uint8Array([0xff, 0xd8])),
      [`GET /shops/${shopId}/events`]: openStream,
      [`POST /shops/${shopId}/payment-reviews/${proofId}/approve`]: () => {
        queue = [];
        decided = [paymentDecision];
        return json(200, { result: 'approved' });
      },
    });
    renderAt(`/shops/${shopId}/payments`, <OwnerApp />);

    expect(await screen.findByText('No payment has been decided yet.')).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: /Approve/ }));
    expect(await screen.findByText(/Nothing to review/)).toBeTruthy();
    const history = screen.getByRole('region', { name: 'Recent decisions' });
    await waitFor(() => {
      expect(history.textContent).toContain('Approved');
    });
    expect(history.textContent).toContain('3,630.00 ብር · Telebirr · bank page: UNAVAILABLE');
    expect(history.textContent).toContain('Decided by You · receiver_unconfirmed');
    expect(calls.some((call) => call.key.endsWith(`${proofId}/approve`))).toBe(true);
  });
});

describe('AI decisions screen', () => {
  it('shows each decision’s reason and evidence, with buttons only where the dashboard can act', async () => {
    fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/ai-decisions`]: () => json(200, decisions),
    });
    renderAt(`/shops/${shopId}/ai-decisions`, <OwnerApp />);

    const far = await screen.findByRole('region', { name: 'Decision propose_delivery_price' });
    expect(far.textContent).toContain('Drivers asked 1,400 birr here last week.');
    expect(far.textContent).toContain('Evidence: quote-1');
    expect(far.textContent).toContain('cap "1000.00"');
    expect(far.textContent).toContain('Answer this with its buttons in your Telegram chat.');
    expect(within(far).queryByRole('button')).toBeNull();

    const bonus = screen.getByRole('region', { name: 'Decision propose_bonus' });
    expect(within(bonus).getByRole('button', { name: /Decline/ })).toBeTruthy();
    expect(screen.getByText('2 waiting for you')).toBeTruthy();
  });

  it('approves a held action and says when it could not run', async () => {
    const { calls } = fakeServer({
      'POST /auth/mini-app': session,
      [`GET /shops/${shopId}`]: () => json(200, shop),
      [`GET /shops/${shopId}/ai-decisions`]: () => json(200, decisions),
      [`POST /shops/${shopId}/ai-decisions/${decisionId}/approve`]: () =>
        json(200, { status: 'approved', error: 'A driver already took this job.' }),
    });
    renderAt(`/shops/${shopId}/ai-decisions`, <OwnerApp />);

    const bonus = await screen.findByRole('region', { name: 'Decision propose_bonus' });
    await userEvent.click(within(bonus).getByRole('button', { name: /Approve/ }));
    expect(await within(bonus).findByText(/A driver already took this job/)).toBeTruthy();
    await waitFor(() => {
      expect(calls.filter((call) => call.key === `GET /shops/${shopId}/ai-decisions`)).toHaveLength(
        2,
      );
    });
  });
});
