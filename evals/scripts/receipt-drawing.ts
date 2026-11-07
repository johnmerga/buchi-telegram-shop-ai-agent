/**
 * The receipt layouts that Buchi reads, drawn as phone screenshots with made-up content. The
 * receipts suite and the demo's payment screenshots both draw with them.
 */
import { existsSync } from 'node:fs';
import { createCanvas, GlobalFonts, type SKRSContext2D } from '@napi-rs/canvas';

const FONT_DIR = '/usr/share/fonts/truetype/noto';
const fonts = {
  'Noto Sans': ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf'],
  'Noto Sans Ethiopic': ['NotoSansEthiopic-Regular.ttf', 'NotoSansEthiopic-Bold.ttf'],
};
const FAMILY = '"Noto Sans", "Noto Sans Ethiopic"';

type Context = SKRSContext2D;
type Row = [label: string, value: string];

export interface Receipt {
  draw(ctx: Context): void;
  width: number;
  height: number;
  /** Turns the finished image a quarter turn, like a photo of a phone held sideways. */
  rotated?: boolean;
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
export function telebirrApp(r: {
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
export function telebirrAppSuccess(r: {
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
export function telebirrWeb(r: {
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
export function cbeApp(r: {
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
export function cbeAppSuccess(r: { lines: [segment: string, bold: boolean][][] }): Receipt {
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
export function cbeWeb(r: {
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
export function cbePdf(r: {
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
export function unknownBank(): Receipt {
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

/** Registers the Noto fonts, which draw Amharic and Latin text alike. */
export function registerFonts(): void {
  for (const [family, files] of Object.entries(fonts)) {
    for (const file of files) {
      const path = `${FONT_DIR}/${file}`;
      if (!existsSync(path)) throw new Error(`Install the Noto fonts first: ${path} is missing`);
      GlobalFonts.registerFromPath(path, family);
    }
  }
}

/** The receipt as a JPEG, turned a quarter when it is a sideways photo. */
export async function renderReceipt(receipt: Receipt): Promise<Buffer> {
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
