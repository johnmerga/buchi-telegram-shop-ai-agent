/**
 * Draws receipt screenshots for a live demo order, timed now, for the customer to send within the
 * order's payment hold. The images go to the gitignored inbox.
 *
 * Telebirr (the default): one short of the total, one that reuses a demo order's reference, and one
 * whose total was edited. None needs Telebirr's page, which only answers inside Ethiopia.
 *
 *   pnpm --filter @buchi/evals demo:receipts --total 3150.00 --name "Selam Tesfaye" --phone 0911234567
 *
 * CBE: one with a made-up transaction ID, which the bank's page does not know, and, given a
 * reference that an earlier order already used, one that reuses it.
 *
 *   pnpm --filter @buchi/evals demo:receipts --bank cbe --total 3150.00 --name "Selam Tesfaye" --reused FT26311ABCDE
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Money } from '@buchi/shared';
import { DEMO_REUSED_TELEBIRR_REF } from '@buchi/server/modules/demo/demo-history.domain';
import { z } from 'zod';
import { cbeApp, registerFonts, renderReceipt, telebirrWeb } from './receipt-drawing';

const OUT_DIR = fileURLToPath(new URL('../inbox/demo-receipts/', import.meta.url));
const ADDIS_ABABA_OFFSET_MS = 3 * 60 * 60_000;
const FEE = Money.of('1.00');

const { values } = parseArgs({
  options: {
    total: { type: 'string' },
    name: { type: 'string' },
    phone: { type: 'string' },
    bank: { type: 'string', default: 'telebirr' },
    reused: { type: 'string' },
  },
});
const bank = z.enum(['telebirr', 'cbe']).parse(values.bank);
const total = Money.of(
  z
    .string()
    .regex(/^\d+\.\d{2}$/, 'Pass --total like 3150.00')
    .parse(values.total),
);
const receiver = z.string().min(2, 'Pass --name, the shop account holder').parse(values.name);

/** Now in Addis Ababa, as ISO text, for the printed dates. */
function addisNow(): string {
  return new Date(Date.now() + ADDIS_ABABA_OFFSET_MS).toISOString();
}

function randomCode(length: number): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  return Array.from(
    { length },
    () => characters[Math.floor(Math.random() * characters.length)],
  ).join('');
}

registerFonts();
await mkdir(OUT_DIR, { recursive: true });
const written = bank === 'cbe' ? await drawCbe() : await drawTelebirr();
console.log(`Wrote ${written.join(', ')} to ${OUT_DIR}`);

/** "DD-MM-YYYY HH:MM:SS" in Addis Ababa, as Telebirr's page prints the payment date. */
function telebirrNow(): string {
  const [date = '', time = ''] = addisNow().split('T');
  const [year, month, day] = date.split('-');
  return `${day ?? ''}-${month ?? ''}-${year ?? ''} ${time.slice(0, 8)}`;
}

async function drawTelebirr(): Promise<string[]> {
  const phone = z
    .string()
    .regex(/^0[79]\d{8}$/, 'Pass --phone like 0911234567')
    .parse(values.phone);
  const short = total.times(8).divideRoundingUp(10);
  const receipts = {
    'underpaid.jpg': { number: `D${randomCode(9)}`, settled: short, paid: short.add(FEE) },
    'reused.jpg': { number: DEMO_REUSED_TELEBIRR_REF, settled: total, paid: total.add(FEE) },
    'edited-total.jpg': {
      number: `D${randomCode(9)}`,
      settled: total,
      paid: total.add(FEE).add(Money.of('500.00')),
    },
  };
  for (const [file, receipt] of Object.entries(receipts)) {
    const image = await renderReceipt(
      telebirrWeb({
        payer: 'Demo Customer',
        payerNo: '2519****1234',
        receiver,
        receiverNo: `2519****${phone.slice(-4)}`,
        number: receipt.number,
        date: telebirrNow(),
        settled: `${receipt.settled.toString()} Birr`,
        fee: `${FEE.toString()} Birr`,
        total: `${receipt.paid.toString()} Birr`,
      }),
    );
    await writeFile(`${OUT_DIR}${file}`, image);
  }
  console.log(
    'From the customer account, within the 3-minute hold of one order: send underpaid.jpg (Buchi ' +
      'asks for the full amount), then edited-total.jpg (it goes to the owner). For a second order, ' +
      'send reused.jpg: it is rejected, with Report a problem.',
  );
  return Object.keys(receipts);
}

/** "08-Nov-26 2:23 PM" in Addis Ababa, as the CBE app prints the transfer time. */
function cbeNow(): string {
  const [date = '', time = ''] = addisNow().split('T');
  const [year = '', month = '', day = ''] = date.split('-');
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const hour = Number(time.slice(0, 2));
  const clock = `${String(hour % 12 || 12)}:${time.slice(3, 5)} ${hour < 12 ? 'AM' : 'PM'}`;
  return `${day}-${months[Number(month) - 1] ?? ''}-${year.slice(2)} ${clock}`;
}

/** A CBE transaction ID for today: FT, the two-digit year and day of the year, five characters. */
function cbeReference(): string {
  const now = new Date(addisNow().slice(0, 10));
  const dayOfYear =
    Math.floor((now.getTime() - Date.UTC(now.getUTCFullYear(), 0, 1)) / 86_400_000) + 1;
  const year = String(now.getUTCFullYear()).slice(2);
  return `FT${year}${String(dayOfYear).padStart(3, '0')}${randomCode(5)}`;
}

async function drawCbe(): Promise<string[]> {
  const reused = z
    .string()
    .regex(/^FT[0-9A-Z]{10}$/, 'Pass --reused like FT26311ABCDE')
    .optional()
    .parse(values.reused);
  const receipts: Record<string, string> = { 'fake-reference.jpg': cbeReference() };
  if (reused) receipts['reused.jpg'] = reused;
  for (const [file, id] of Object.entries(receipts)) {
    const image = await renderReceipt(
      cbeApp({
        amount: `-${total.toString()}`,
        to: receiver.toUpperCase(),
        time: cbeNow(),
        id,
        receiptId: `v2-${randomCode(20)}`,
      }),
    );
    await writeFile(`${OUT_DIR}${file}`, image);
  }
  console.log(
    'From the customer account: send fake-reference.jpg for one order (the bank does not know it, ' +
      'so it goes to the owner). For a second order, send reused.jpg: it is rejected.',
  );
  return Object.keys(receipts);
}
