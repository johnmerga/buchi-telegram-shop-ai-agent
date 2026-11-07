/**
 * Draws the synthetic receipt screenshots of the `receipts` suite and writes its dataset. Every
 * name, account, reference, and amount is made up; references follow each provider's format and
 * agree with their dates, except in the cases that are edited on purpose. Run it again after a
 * change: `pnpm --filter @buchi/evals receipts:generate`.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';

const FONT_DIR = '/usr/share/fonts/truetype/noto';
const fonts = {
  'Noto Sans': ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'],
  'Noto Sans Ethiopic': ['NotoSansEthiopic-Regular.ttf', 'NotoSansEthiopic-Bold.ttf'],
};
const FAMILY = '"Noto Sans", "Noto Sans Ethiopic"';

const imagesDir = fileURLToPath(new URL('../datasets/receipts/', import.meta.url));
const datasetPath = fileURLToPath(new URL('../datasets/receipts.jsonl', import.meta.url));

type Context = SKRSContext2D;
type Row = [label: string, value: string];

interface Receipt {
  draw(ctx: Context): void;
  width: number;
  height: number;
  /** Turns the finished image a quarter turn, like a photo of a phone held sideways. */
  rotated?: boolean;
}

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

function font(size: number, bold = false): string {
  return `${bold ? 'bold ' : ''}${String(size)}px ${FAMILY}`;
}

function text(ctx: Context, value: string, x: number, y: number, style: TextStyle = {}): void {
  ctx.font = font(style.size ?? 22, style.bold);
  ctx.fillStyle = style.color ?? '#1d1d1f';
  ctx.textAlign = style.align ?? 'left';
  ctx.fillText(value, x, y);
}

interface TextStyle {
  size?: number;
  bold?: boolean;
  color?: string;
  align?: 'left' | 'right' | 'center';
}

function box(ctx: Context, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 18);
  ctx.fill();
}

/** The Telebirr app's "Transaction Detail" screen. */
function telebirrApp(r: {
  amount: string;
  time: string;
  number: string;
  to: string;
  charge: string;
}): Receipt {
  return {
    width: 576,
    height: 1000,
    draw(ctx) {
      ctx.fillStyle = '#f3f3f3';
      ctx.fillRect(0, 0, 576, 1000);
      text(ctx, '9:04', 24, 34, { size: 20, bold: true });
      text(ctx, '<', 30, 92, { size: 30 });
      text(ctx, 'Transaction Detail', 88, 90, { size: 24, bold: true });
      box(ctx, 18, 140, 540, 690, '#ffffff');
      ctx.fillStyle = '#8dc63f';
      ctx.beginPath();
      ctx.arc(288, 222, 38, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, r.amount, 270, 336, { size: 48, bold: true, align: 'right' });
      text(ctx, 'ETB', 280, 334, { size: 22 });
      const rows: Row[] = [
        ['Transaction Time:', r.time],
        ['Transaction No.', r.number],
        ['Transaction Type', 'Send Money'],
        ['Transaction To', r.to],
        ['Transaction Amount', `${r.amount} ETB`],
        ['Transaction Status', 'Completed'],
        ['Service Charge', `${r.charge} ETB`],
      ];
      rows.forEach(([label, value], i) => {
        const y = 442 + i * 57;
        text(ctx, label, 36, y, { color: '#9a9a9a' });
        text(ctx, value, 540, y, { align: 'right' });
      });
      box(ctx, 18, 855, 540, 72, '#ffffff');
      text(ctx, 'Click here to get the invoice', 96, 898, { size: 20 });
    },
  };
}

/** The Telebirr app's screen right after a payment, whose amount includes the fee. */
function telebirrAppSuccess(r: {
  total: string;
  time: string;
  number: string;
  to: string;
}): Receipt {
  return {
    width: 576,
    height: 1000,
    draw(ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 576, 1000);
      text(ctx, '1:54', 24, 34, { size: 20, bold: true });
      text(ctx, 'Download', 52, 112, { size: 20, color: '#8dc63f' });
      text(ctx, 'Share', 552, 112, { size: 20, color: '#8dc63f', align: 'right' });
      ctx.fillStyle = '#8dc63f';
      ctx.beginPath();
      ctx.arc(288, 182, 38, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, 'Successful', 288, 256, { size: 22, color: '#8dc63f', align: 'center' });
      text(ctx, r.total, 330, 446, { size: 48, align: 'right' });
      text(ctx, '(ETB)', 340, 444, { size: 18 });
      box(ctx, 44, 530, 488, 2, '#dddddd');
      const rows: Row[] = [
        ['Transaction Time:', r.time],
        ['Transaction Type:', 'Transfer Money'],
        ['Transaction To:', r.to],
        ['Transaction Number:', r.number],
      ];
      rows.forEach(([label, value], i) => {
        const y = 568 + i * 50;
        text(ctx, label, 46, y, { color: '#9a9a9a' });
        text(ctx, value, 544, y, { align: 'right' });
      });
      box(ctx, 154, 890, 260, 60, '#8dc63f');
      text(ctx, 'Finished', 284, 928, { size: 22, color: '#ffffff', align: 'center' });
    },
  };
}

/** Ethio telecom's telebirr receipt page, as a customer's screenshot of it. */
function telebirrWeb(r: {
  payer: string;
  payerNo: string;
  receiver: string;
  receiverNo: string;
  number: string;
  date: string;
  settled: string;
  fee: string;
  total: string;
}): Receipt {
  return {
    width: 760,
    height: 900,
    draw(ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 760, 900);
      ctx.fillStyle = '#0a8ccc';
      ctx.fillRect(0, 0, 760, 90);
      text(ctx, 'telebirr', 30, 58, { size: 34, bold: true, color: '#ffffff' });
      text(ctx, 'Ethio telecom Share Company', 730, 56, {
        size: 18,
        color: '#ffffff',
        align: 'right',
      });
      const rows: Row[] = [
        ['የከፋይ ስም/Payer Name', r.payer],
        ['የከፋይ ቴሌብር ቁ./Payer telebirr no.', r.payerNo],
        ['የገንዘብ ተቀባይ ስም/Credited Party name', r.receiver],
        ['የገንዘብ ተቀባይ ቴሌብር ቁ./Credited party account no', r.receiverNo],
        ['የክፍያው ሁኔታ/transaction status', 'Completed'],
      ];
      ctx.strokeStyle = '#c8c8c8';
      rows.forEach(([label, value], i) => {
        const y = 130 + i * 56;
        ctx.strokeRect(30, y, 700, 56);
        text(ctx, label, 42, y + 35, { size: 17 });
        text(ctx, value, 440, y + 35, { size: 18 });
      });
      text(ctx, 'የክፍያ ዝርዝር/ Invoice details', 380, 470, { size: 20, bold: true, align: 'center' });
      const headers = ['የክፍያ ቁጥር/Invoice No.', 'የክፍያ ቀን/Payment date', 'የተከፈለው መጠን/Settled Amount'];
      const values = [r.number, r.date, r.settled];
      headers.forEach((header, i) => {
        const x = 30 + i * 233;
        ctx.fillStyle = '#e6f3fa';
        ctx.fillRect(x, 495, 233, 56);
        ctx.strokeRect(x, 495, 233, 56);
        ctx.strokeRect(x, 551, 233, 56);
        text(ctx, header, x + 10, 530, { size: 15, bold: true });
        text(ctx, values[i] ?? '', x + 10, 586, { size: 18 });
      });
      const totals: Row[] = [
        ['የአገልግሎት ክፍያ/Service fee', r.fee],
        ['ጠቅላላ የተከፈለ/Total Paid Amount', r.total],
      ];
      totals.forEach(([label, value], i) => {
        const y = 640 + i * 56;
        ctx.strokeRect(30, y, 700, 56);
        text(ctx, label, 42, y + 35, { size: 17 });
        text(ctx, value, 700, y + 35, { size: 18, align: 'right' });
      });
    },
  };
}

/** The CBE mobile app's "Transaction detail" sheet, as a phone screenshot. */
function cbeApp(r: {
  amount: string;
  to: string;
  time: string;
  id: string;
  receiptId: string;
  rotated?: boolean;
}): Receipt {
  return {
    width: 600,
    height: 1100,
    rotated: r.rotated ?? false,
    draw(ctx) {
      ctx.fillStyle = '#5b2c8f';
      ctx.fillRect(0, 0, 600, 1100);
      text(ctx, 'Hello,', 90, 90, { size: 16, color: '#e0d4f0' });
      text(ctx, 'Commercial Bank of Ethiopia', 300, 170, {
        size: 22,
        color: '#f0c96a',
        align: 'center',
      });
      box(ctx, 20, 330, 560, 760, '#fafafa');
      text(ctx, 'TRANSACTION DETAIL', 300, 380, { size: 15, color: '#777777', align: 'center' });
      box(ctx, 225, 410, 150, 40, '#e3f3ea');
      text(ctx, 'Completed', 300, 437, { size: 18, color: '#1f8a4c', align: 'center' });
      text(ctx, `${r.amount} ETB`, 300, 510, { size: 34, align: 'center' });
      text(ctx, `to ${r.to}`, 300, 550, { size: 19, color: '#555555', align: 'center' });
      const rows: Row[] = [
        ['Date & Time', r.time],
        ['Type', 'Account to Account'],
        ['Transaction ID', r.id],
        ['Receipt ID', r.receiptId],
        ['Remark', 'MB Transfer'],
      ];
      rows.forEach(([label, value], i) => {
        const y = 640 + i * 62;
        text(ctx, label, 50, y, { size: 18, color: '#666666' });
        text(ctx, value, 550, y, { size: 18, align: 'right' });
      });
      box(ctx, 170, 970, 260, 64, '#8e2bd6');
      text(ctx, 'VIEW RECEIPT', 300, 1010, { size: 18, color: '#ffffff', align: 'center' });
    },
  };
}

/**
 * The CBE app's screen right after a transfer: one summary sentence, wrapped as on a phone, with
 * the amounts, names, date, and transaction ID in bold.
 */
function cbeAppSuccess(r: { lines: [segment: string, bold: boolean][][] }): Receipt {
  return {
    width: 600,
    height: 1200,
    draw(ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 600, 1200);
      ctx.fillStyle = '#7b1fa2';
      ctx.fillRect(0, 0, 600, 230);
      text(ctx, 'Thank you', 90, 120, { size: 26, bold: true, color: '#ffffff' });
      text(ctx, 'Success', 90, 152, { size: 17, color: '#f3e5f5' });
      ctx.fillStyle = '#7b1fa2';
      ctx.beginPath();
      ctx.arc(300, 230, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(262, 232);
      ctx.lineTo(290, 260);
      ctx.lineTo(342, 204);
      ctx.stroke();
      text(ctx, 'Transaction Completed Successfully!', 300, 345, { size: 19, align: 'center' });
      box(ctx, 30, 380, 540, 700, '#f2f2f2');
      text(ctx, 'Transaction Summary', 56, 420, { size: 18, color: '#9a9a9a' });
      r.lines.forEach((line, i) => {
        let x = 56;
        for (const [segment, bold] of line) {
          text(ctx, segment, x, 470 + i * 38, { size: 22, bold });
          x += ctx.measureText(segment).width;
        }
      });
      text(ctx, 'Commercial Bank of Ethiopia', 150, 1010, {
        size: 18,
        bold: true,
        color: '#444444',
      });
      text(ctx, 'The bank you can always rely on!', 150, 1038, { size: 16, color: '#555555' });
    },
  };
}

/** The CBE "Customer Receipt" web page of the newer `mbreciept` host. */
function cbeWeb(r: {
  payer: string;
  payerAccount: string;
  receiver: string;
  receiverAccount: string;
  time: string;
  reference: string;
  amount: string;
  charge: string;
  vat: string;
  total: string;
}): Receipt {
  return {
    width: 720,
    height: 980,
    draw(ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 720, 980);
      text(ctx, 'Commercial Bank of Ethiopia', 360, 70, {
        size: 28,
        bold: true,
        color: '#5b2c8f',
        align: 'center',
      });
      text(ctx, 'Customer Receipt', 360, 115, { size: 22, align: 'center' });
      text(ctx, 'Status: COMPLETED', 360, 155, { size: 18, color: '#1f8a4c', align: 'center' });
      const rows: Row[] = [
        ['Payer', r.payer],
        ['Account', r.payerAccount],
        ['Receiver', r.receiver],
        ['Account', r.receiverAccount],
        ['Payment Type', 'A2A'],
        ['Payment Date & Time:', r.time],
        ['Reference No. (VAT Invoice No):', r.reference],
        ['Transferred Amount:', r.amount],
        ['Service Charge:', r.charge],
        ['VAT (15%):', r.vat],
        ['Total amount debited from customers account:', r.total],
      ];
      rows.forEach(([label, value], i) => {
        const y = 230 + i * 62;
        ctx.fillStyle = i % 2 === 0 ? '#f6f2fa' : '#ffffff';
        ctx.fillRect(30, y - 38, 660, 62);
        text(ctx, label, 46, y, { size: 17, color: '#444444' });
        text(ctx, value, 674, y, { size: 18, bold: true, align: 'right' });
      });
    },
  };
}

/** The legacy CBE "VAT Invoice / Customer Receipt" PDF, with a receiver name over two lines. */
function cbePdf(r: {
  payer: string;
  payerAccount: string;
  receiver: [string, string];
  receiverAccount: string;
  time: string;
  reference: string;
  amount: string;
  charge: string;
  vat: string;
  total: string;
}): Receipt {
  return {
    width: 800,
    height: 1000,
    draw(ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 800, 1000);
      text(ctx, 'Commercial Bank of Ethiopia', 400, 70, { size: 26, bold: true, align: 'center' });
      text(ctx, 'VAT Invoice / Customer Receipt', 400, 108, { size: 20, align: 'center' });
      text(ctx, 'Payment / Transaction Information', 60, 180, { size: 19, bold: true });
      const rows: (Row | [string, string, string])[] = [
        ['Payer', r.payer],
        ['Account', r.payerAccount],
        ['Receiver', ...r.receiver],
        ['Account', r.receiverAccount],
        ['Payment Date & Time', r.time],
        ['Reference No. (VAT Invoice No)', r.reference],
        ['Reason / Type of service', 'Pay done via Mobile'],
        ['Transferred Amount', r.amount],
        ['Commission or Service Charge', r.charge],
        ['15% VAT on Commission', r.vat],
        ['Total amount debited from customers account', r.total],
      ];
      let y = 230;
      ctx.strokeStyle = '#999999';
      for (const [label, ...values] of rows) {
        const height = 30 + values.length * 26;
        ctx.strokeRect(50, y - 30, 700, height);
        text(ctx, label, 64, y, { size: 17 });
        values.forEach((value, i) => {
          text(ctx, value, 470, y + i * 26, { size: 17 });
        });
        y += height;
      }
    },
  };
}

/** A transfer confirmation from a bank whose layout Buchi does not know. All of it is made up. */
function unknownBank(): Receipt {
  return {
    width: 600,
    height: 800,
    draw(ctx) {
      ctx.fillStyle = '#0f3d3e';
      ctx.fillRect(0, 0, 600, 800);
      box(ctx, 30, 120, 540, 600, '#ffffff');
      text(ctx, 'Lucy Bank', 300, 80, { size: 34, bold: true, color: '#f2c14e', align: 'center' });
      text(ctx, 'Transfer Successful', 300, 190, { size: 26, bold: true, align: 'center' });
      text(ctx, 'ETB 700.00', 300, 260, { size: 40, bold: true, align: 'center' });
      const rows: Row[] = [
        ['Beneficiary', 'Liya Bekele Tadesse'],
        ['Beneficiary Bank', 'Telebirr Wallet'],
        ['Value Date', '2026-11-05 13:40'],
        ['Ref', 'LB2611050042'],
      ];
      rows.forEach(([label, value], i) => {
        const y = 360 + i * 70;
        text(ctx, label, 60, y, { size: 19, color: '#666666' });
        text(ctx, value, 540, y, { size: 19, align: 'right' });
      });
    },
  };
}

// The evaluation shop's accounts, as the runner sets them up: Telebirr in Liya's name and CBE in
// Meron's. Orders are placed on Thursday 5 November 2026, minutes before each payment.
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
      decision: 'review:reference_date',
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

async function render({ receipt }: Case): Promise<Buffer> {
  const canvas = createCanvas(receipt.width, receipt.height);
  receipt.draw(canvas.getContext('2d'));
  if (!receipt.rotated) return canvas.encode('jpeg', 85);
  const turned = createCanvas(receipt.height, receipt.width);
  const ctx = turned.getContext('2d');
  ctx.translate(receipt.height, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(canvas, 0, 0);
  return turned.encode('jpeg', 85);
}

async function main(): Promise<void> {
  for (const [family, files] of Object.entries(fonts)) {
    for (const file of files) {
      const path = `${FONT_DIR}/${file}`;
      if (!existsSync(path)) throw new Error(`Install the Noto fonts first: ${path} is missing`);
      GlobalFonts.registerFromPath(path, family);
    }
  }
  await mkdir(imagesDir, { recursive: true });
  const lines: string[] = [];
  for (const testCase of cases) {
    const image = `${testCase.id}.jpg`;
    await writeFile(`${imagesDir}${image}`, await render(testCase));
    const { id, input, expected } = testCase;
    lines.push(JSON.stringify({ id, input: { image, ...input }, expected }));
  }
  await writeFile(datasetPath, `${lines.join('\n')}\n`);
  console.log(`Wrote ${String(cases.length)} receipts to ${imagesDir}`);
}

await main();
