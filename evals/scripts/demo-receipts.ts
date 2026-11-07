/**
 * Draws three Telebirr receipt screenshots for a live demo order, timed now, for the customer to
 * send within the order's payment hold: one short of the total, one that reuses a demo order's
 * reference, and one whose total was edited. The images go to the gitignored inbox.
 *
 *   pnpm --filter @buchi/evals demo:receipts --total 3150.00 --name "Selam Tesfaye" --phone 0911234567
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Money } from '@buchi/shared';
import { DEMO_REUSED_TELEBIRR_REF } from '@buchi/server/modules/demo/demo-history.domain';
import { z } from 'zod';
import { registerFonts, renderReceipt, telebirrWeb } from './receipt-drawing';

const OUT_DIR = fileURLToPath(new URL('../inbox/demo-receipts/', import.meta.url));
const ADDIS_ABABA_OFFSET_MS = 3 * 60 * 60_000;
const FEE = Money.of('1.00');

const { values } = parseArgs({
  options: {
    total: { type: 'string' },
    name: { type: 'string' },
    phone: { type: 'string' },
  },
});
const total = Money.of(
  z
    .string()
    .regex(/^\d+\.\d{2}$/, 'Pass --total like 3150.00')
    .parse(values.total),
);
const receiver = z.string().min(2, 'Pass --name, the shop account holder').parse(values.name);
const phone = z
  .string()
  .regex(/^0[79]\d{8}$/, 'Pass --phone like 0911234567')
  .parse(values.phone);

/** "DD-MM-YYYY HH:MM:SS" in Addis Ababa, as Telebirr's page prints the payment date. */
function printedNow(): string {
  const local = new Date(Date.now() + ADDIS_ABABA_OFFSET_MS).toISOString();
  const [date = '', time = ''] = local.split('T');
  const [year, month, day] = date.split('-');
  return `${day ?? ''}-${month ?? ''}-${year ?? ''} ${time.slice(0, 8)}`;
}

function randomReference(): string {
  const characters = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  const code = Array.from(
    { length: 9 },
    () => characters[Math.floor(Math.random() * characters.length)],
  ).join('');
  return `D${code}`;
}

const short = total.times(8).divideRoundingUp(10);
const receipts = {
  'underpaid.jpg': { number: randomReference(), settled: short, paid: short.add(FEE) },
  'reused.jpg': { number: DEMO_REUSED_TELEBIRR_REF, settled: total, paid: total.add(FEE) },
  'edited-total.jpg': {
    number: randomReference(),
    settled: total,
    paid: total.add(FEE).add(Money.of('500.00')),
  },
};

registerFonts();
await mkdir(OUT_DIR, { recursive: true });
for (const [file, receipt] of Object.entries(receipts)) {
  const image = await renderReceipt(
    telebirrWeb({
      payer: 'Demo Customer',
      payerNo: '2519****1234',
      receiver,
      receiverNo: `2519****${phone.slice(-4)}`,
      number: receipt.number,
      date: printedNow(),
      settled: `${receipt.settled.toString()} Birr`,
      fee: `${FEE.toString()} Birr`,
      total: `${receipt.paid.toString()} Birr`,
    }),
  );
  await writeFile(`${OUT_DIR}${file}`, image);
}
console.log(`Wrote ${Object.keys(receipts).join(', ')} to ${OUT_DIR}`);
console.log(
  'From the customer account, within the 3-minute hold of one order: send underpaid.jpg (Buchi ' +
    'asks for the full amount), then edited-total.jpg (it goes to the owner). For a second order, ' +
    'send reused.jpg: it is rejected, with Report a problem.',
);
