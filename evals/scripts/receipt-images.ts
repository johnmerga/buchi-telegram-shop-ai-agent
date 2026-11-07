/**
 * Draws the synthetic receipt screenshots of the `receipts` suite and writes its dataset. Every
 * name, account, reference, and amount is made up; references follow each provider's format and
 * agree with their dates, except in the cases that are edited on purpose. Run it again after a
 * change: `pnpm --filter @buchi/evals receipts:generate`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  cbeApp,
  cbeAppSuccess,
  cbePdf,
  cbeWeb,
  registerFonts,
  renderReceipt,
  telebirrApp,
  telebirrAppSuccess,
  telebirrWeb,
  unknownBank,
  type Receipt,
} from './receipt-drawing';

const imagesDir = fileURLToPath(new URL('../datasets/receipts/', import.meta.url));
const datasetPath = fileURLToPath(new URL('../datasets/receipts.jsonl', import.meta.url));

interface Case {
  id: string;
  receipt: Receipt;
  input: { orderTotal: string; orderPlacedAt: string; usedReferences: string[] };
  expected: {
    layout: string;
    fields: { transactionRef: string; amount: string; paidAt: string; receiverName: string } | null;
    decision: string;
  };
}

const MERON = 'Meron Alemu Kebede';
const order = (orderTotal: string, orderPlacedAt: string, usedReferences: string[] = []) => ({
  orderTotal,
  orderPlacedAt,
  usedReferences,
});
const fields = (transactionRef: string, amount: string, paidAt: string, receiverName: string) => ({
  transactionRef,
  amount,
  paidAt,
  receiverName,
});

const cases: Case[] = [
  {
    id: 'telebirr-app-first-name-only',
    receipt: telebirrApp({
      amount: '-850.00',
      time: '2026/05/11 14:32:10',
      number: 'QX41ZB7KM2',
      to: 'Liya',
      charge: '-2.00',
    }),
    input: order('850.00', '2026-11-05T11:20:00Z'),
    expected: {
      layout: 'telebirr_app',
      fields: fields('QX41ZB7KM2', '850.00', '2026-11-05T11:32:10.000Z', 'Liya'),
      decision: 'review:receiver_unconfirmed',
    },
  },
  {
    id: 'telebirr-app-underpaid',
    receipt: telebirrApp({
      amount: '-500.00',
      time: '2026/05/11 09:05:44',
      number: 'HB7Q2WD9LM',
      to: 'Liya',
      charge: '-1.00',
    }),
    input: order('650.00', '2026-11-05T05:58:00Z'),
    expected: {
      layout: 'telebirr_app',
      fields: fields('HB7Q2WD9LM', '500.00', '2026-11-05T06:05:44.000Z', 'Liya'),
      decision: 'ask_full_amount',
    },
  },
  {
    id: 'telebirr-app-payment-screen',
    receipt: telebirrAppSuccess({
      total: '-726.00',
      time: '2026/11/05 16:08:51',
      number: 'RT58WMC2QJ',
      to: 'LIYA',
    }),
    input: order('725.00', '2026-11-05T12:59:00Z'),
    expected: {
      layout: 'telebirr_app_success',
      fields: fields('RT58WMC2QJ', '726.00', '2026-11-05T13:08:51.000Z', 'LIYA'),
      decision: 'review:receiver_unconfirmed',
    },
  },
  {
    id: 'telebirr-app-older-than-order',
    receipt: telebirrApp({
      amount: '-1,200.00',
      time: '2026/02/11 18:14:03',
      number: 'ZP3K8RT5VA',
      to: 'Liya',
      charge: '-3.00',
    }),
    input: order('1200.00', '2026-11-05T10:00:00Z'),
    expected: {
      layout: 'telebirr_app',
      fields: fields('ZP3K8RT5VA', '1200.00', '2026-11-02T15:14:03.000Z', 'Liya'),
      decision: 'reject:time',
    },
  },
  {
    id: 'telebirr-web-small',
    receipt: telebirrWeb({
      payer: 'Dawit Hailu Gebre',
      payerNo: '2519****5521',
      receiver: 'LIYA BEKELE TADESSE',
      receiverNo: '2519****3344',
      number: 'MC5T9EJ2RA',
      date: '05-11-2026 16:48:27',
      settled: '600 Birr',
      fee: '0.52 Birr',
      total: '601 Birr',
    }),
    input: order('600.00', '2026-11-05T13:40:00Z'),
    expected: {
      layout: 'telebirr_web',
      fields: fields('MC5T9EJ2RA', '600.00', '2026-11-05T13:48:27.000Z', 'LIYA BEKELE TADESSE'),
      decision: 'approve',
    },
  },
  {
    id: 'telebirr-web-over-limit',
    receipt: telebirrWeb({
      payer: 'Hana Girma Wolde',
      payerNo: '2519****7012',
      receiver: 'LIYA BEKELE TADESSE',
      receiverNo: '2519****3344',
      number: 'RW8N4DK7PB',
      date: '05-11-2026 10:02:51',
      settled: '2,400 Birr',
      fee: '2.08 Birr',
      total: '2,402 Birr',
    }),
    input: order('2400.00', '2026-11-05T06:55:00Z'),
    expected: {
      layout: 'telebirr_web',
      fields: fields('RW8N4DK7PB', '2400.00', '2026-11-05T07:02:51.000Z', 'LIYA BEKELE TADESSE'),
      decision: 'review:over_limit',
    },
  },
  {
    id: 'telebirr-web-reused-reference',
    receipt: telebirrWeb({
      payer: 'Samuel Tesfaye Alemu',
      payerNo: '2519****8890',
      receiver: 'LIYA BEKELE TADESSE',
      receiverNo: '2519****3344',
      number: 'KD2M7XQ4NE',
      date: '05-11-2026 12:21:09',
      settled: '450 Birr',
      fee: '0.39 Birr',
      total: '450 Birr',
    }),
    input: order('450.00', '2026-11-05T09:15:00Z', ['KD2M7XQ4NE']),
    expected: {
      layout: 'telebirr_web',
      fields: fields('KD2M7XQ4NE', '450.00', '2026-11-05T09:21:09.000Z', 'LIYA BEKELE TADESSE'),
      decision: 'reject:reused',
    },
  },
  {
    id: 'cbe-app-small',
    receipt: cbeApp({
      amount: '-750.00',
      to: MERON,
      time: '05-Nov-26 3:12 PM',
      id: 'FT26309XK4P2',
      receiptId: 'v2-tQ8sLmZpR3nKw7YbHc2D',
    }),
    input: order('750.00', '2026-11-05T12:01:00Z'),
    expected: {
      layout: 'cbe_app',
      fields: fields('FT26309XK4P2', '750.00', '2026-11-05T12:12:00.000Z', MERON),
      decision: 'approve',
    },
  },
  {
    id: 'cbe-app-rotated-evening',
    receipt: cbeApp({
      amount: '-920.00',
      to: MERON,
      time: '04-Nov-26 8:45 PM',
      id: 'FT26309B7WQ5',
      receiptId: 'v2-Jd4kPq9WmXc2LsVb8RtN',
      rotated: true,
    }),
    input: order('920.00', '2026-11-04T17:30:00Z'),
    expected: {
      layout: 'cbe_app',
      fields: fields('FT26309B7WQ5', '920.00', '2026-11-04T17:45:00.000Z', MERON),
      decision: 'approve',
    },
  },
  {
    id: 'cbe-app-over-limit',
    receipt: cbeApp({
      amount: '-3,500.00',
      to: MERON,
      time: '05-Nov-26 11:03 AM',
      id: 'FT26309T5HJ8',
      receiptId: 'v2-Mn3bVc8XzLk4JhGf6DsA',
    }),
    input: order('3500.00', '2026-11-05T07:50:00Z'),
    expected: {
      layout: 'cbe_app',
      fields: fields('FT26309T5HJ8', '3500.00', '2026-11-05T08:03:00.000Z', MERON),
      decision: 'review:over_limit',
    },
  },
  {
    id: 'cbe-app-edited-reference-day',
    receipt: cbeApp({
      amount: '-640.00',
      to: MERON,
      time: '05-Nov-26 10:05 AM',
      id: 'FT26250AB7Q1',
      receiptId: 'v2-Qw2eRt5YuIo8PaSd3FgH',
    }),
    input: order('640.00', '2026-11-05T06:58:00Z'),
    expected: {
      layout: 'cbe_app',
      fields: fields('FT26250AB7Q1', '640.00', '2026-11-05T07:05:00.000Z', MERON),
      // The edited day reads as a misread reference, so Buchi asks the customer to type it.
      decision: 'ask_reference',
    },
  },
  {
    id: 'cbe-app-payment-summary',
    receipt: cbeAppSuccess({
      lines: [
        [
          ['ETB ', false],
          ['650.00', true],
          [' has been debited from ', false],
        ],
        [
          ['Yonas Bekele Abebe', true],
          [' ETB-7781 for ', false],
        ],
        [
          ['Meron Alemu Kebede', true],
          [' ETB-1234 on ', false],
          ['Nov 05,', true],
        ],
        [
          ['2026 02:40 PM', true],
          [' with transaction ID:', false],
        ],
        [
          ['FT26309QW7RD', true],
          ['. Reason: MB Transfer', false],
        ],
        [['Total Amount Debited: ETB650.61 with', false]],
        [['Service Charge of ETB0.50, VAT (15%) of', false]],
        [['ETB0.08 and Disaster Recovery (5%) of', false]],
        [['ETB0.03.', false]],
      ],
    }),
    input: order('650.00', '2026-11-05T11:30:00Z'),
    expected: {
      layout: 'cbe_app_success',
      fields: fields('FT26309QW7RD', '650.00', '2026-11-05T11:40:00.000Z', MERON),
      decision: 'approve',
    },
  },
  {
    id: 'cbe-app-summary-repeated-zeros',
    receipt: cbeAppSuccess({
      lines: [
        [
          ['ETB ', false],
          ['17.50', true],
          [' has been debited from ', false],
        ],
        [
          ['Dawit Hailu Mekonnen', true],
          [' ETB-5520 for ', false],
        ],
        [
          ['Meron Alemu Kebede', true],
          [' ETB-1234 on ', false],
          ['Nov 05,', true],
        ],
        [
          ['2026 12:10 PM', true],
          [' with transaction ID:', false],
        ],
        [
          ['FT26309000KR', true],
          ['. Reason: MB Transfer', false],
        ],
        [['Total Amount Debited: ETB18.11 with', false]],
        [['Service Charge of ETB0.50, VAT (15%) of', false]],
        [['ETB0.08 and Disaster Recovery (5%) of', false]],
        [['ETB0.03.', false]],
      ],
    }),
    input: order('17.50', '2026-11-05T09:05:00Z'),
    expected: {
      layout: 'cbe_app_success',
      fields: fields('FT26309000KR', '17.50', '2026-11-05T09:10:00.000Z', MERON),
      decision: 'approve',
    },
  },
  {
    id: 'cbe-web-at-limit',
    receipt: cbeWeb({
      payer: 'Yonas Bekele Abebe',
      payerAccount: '1****7781',
      receiver: MERON,
      receiverAccount: '1****1234',
      time: 'Nov 5, 2026, 11:17 AM',
      reference: 'FT26309M2QDA',
      amount: '1000.00 ETB',
      charge: '0.53 ETB',
      vat: '0.08 ETB',
      total: '1000.61 ETB',
    }),
    input: order('1000.00', '2026-11-05T08:10:00Z'),
    expected: {
      layout: 'cbe_web',
      fields: fields('FT26309M2QDA', '1000.00', '2026-11-05T08:17:00.000Z', MERON),
      decision: 'approve',
    },
  },
  {
    id: 'cbe-web-edited-amount',
    receipt: cbeWeb({
      payer: 'Abel Tadesse Wolde',
      payerAccount: '1****4410',
      receiver: MERON,
      receiverAccount: '1****1234',
      time: 'Nov 5, 2026, 2:26 PM',
      reference: 'FT26309RZ6KC',
      amount: '1,500.00 ETB',
      charge: '0.53 ETB',
      vat: '0.08 ETB',
      total: '1000.61 ETB',
    }),
    input: order('1500.00', '2026-11-05T11:20:00Z'),
    expected: {
      layout: 'cbe_web',
      fields: fields('FT26309RZ6KC', '1500.00', '2026-11-05T11:26:00.000Z', MERON),
      decision: 'review:amount_total',
    },
  },
  {
    id: 'cbe-pdf-wrapped-receiver',
    receipt: cbePdf({
      payer: 'TSION GETACHEW MEKONNEN',
      payerAccount: '1****3307',
      receiver: ['MERON ALEMU', 'KEBEDE'],
      receiverAccount: '1****1234',
      time: '11/5/2026, 4:40:00 PM',
      reference: 'FT26309QW3RT',
      amount: '900.00 ETB',
      charge: '0.53 ETB',
      vat: '0.08 ETB',
      total: '900.61 ETB',
    }),
    input: order('900.00', '2026-11-05T13:31:00Z'),
    expected: {
      layout: 'cbe_pdf',
      fields: fields('FT26309QW3RT', '900.00', '2026-11-05T13:40:00.000Z', 'MERON ALEMU KEBEDE'),
      decision: 'approve',
    },
  },
  {
    id: 'cbe-pdf-other-receiver',
    receipt: cbePdf({
      payer: 'KIDIST ASFAW BELAY',
      payerAccount: '1****2290',
      receiver: ['BETELHEM WORKU', 'DESTA'],
      receiverAccount: '1****9876',
      time: '11/5/2026, 9:12:00 AM',
      reference: 'FT26309LP8VN',
      amount: '880.00 ETB',
      charge: '0.53 ETB',
      vat: '0.08 ETB',
      total: '880.61 ETB',
    }),
    input: order('880.00', '2026-11-05T06:05:00Z'),
    expected: {
      layout: 'cbe_pdf',
      fields: fields('FT26309LP8VN', '880.00', '2026-11-05T06:12:00.000Z', 'BETELHEM WORKU DESTA'),
      decision: 'reject:receiver',
    },
  },
  {
    id: 'unknown-bank-layout',
    receipt: unknownBank(),
    input: order('700.00', '2026-11-05T10:30:00Z'),
    expected: { layout: 'unknown', fields: null, decision: 'review:unknown_layout' },
  },
];

async function main(): Promise<void> {
  registerFonts();
  await mkdir(imagesDir, { recursive: true });
  const lines: string[] = [];
  for (const testCase of cases) {
    const image = `${testCase.id}.jpg`;
    await writeFile(`${imagesDir}${image}`, await renderReceipt(testCase.receipt));
    const { id, input, expected } = testCase;
    lines.push(JSON.stringify({ id, input: { image, ...input }, expected }));
  }
  await writeFile(datasetPath, `${lines.join('\n')}\n`);
  console.log(`Wrote ${String(cases.length)} receipts to ${imagesDir}`);
}

await main();
