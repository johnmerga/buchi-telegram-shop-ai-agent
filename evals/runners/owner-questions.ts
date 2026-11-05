import { productInputSchema } from '@buchi/shared';
import { askDataOutputSchema } from '@buchi/server/ai/agents/owner-assistant/tools/ask-data';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import type { Database } from '@buchi/server/db/client';
import { z } from 'zod';
import { defineSuite, type Suite } from '../harness/suite';
import { createOwnerShop } from './owner-shop';

const NOW = new Date('2026-11-05T14:00:00Z');
const OWNER = { telegramUserId: 1 };

/** A question answers with the rows of its reference query; a forbidden one has none. */
const input = z.strictObject({
  question: z.string().min(1),
  referenceSql: z.string().min(1).optional(),
});

const expected = z.strictObject({ refused: z.boolean() });

type Row = (string | number | boolean | null)[];

interface Actual {
  /** The rows of the agent's last successful query, as values in column order, or null. */
  rows: Row[] | null;
  reference: Row[] | null;
  reply: string;
}

type OwnerShop = ReturnType<typeof createOwnerShop>;

/** The same small shop for every case: two shoes sold, one size sold out. */
async function seed(shop: OwnerShop, shopId: string): Promise<void> {
  const sales = [
    { title: 'Nike Air', price: '3500', sizes: { '42': 10, '43': 0 }, sold: 3 },
    { title: 'Adidas Samba', price: '3200', sizes: { '41': 5 }, sold: 1 },
  ];
  for (const [index, item] of sales.entries()) {
    const product = await shop.catalog.createProduct(
      shopId,
      productInputSchema.parse({ title: item.title, pricingMode: 'fixed', price: item.price }),
    );
    await shop.catalog.setVariants(
      shopId,
      product.id,
      Object.entries(item.sizes).map(([size, stock]) => ({ size, color: null, stock })),
    );
    const [listed] = await shop.catalog.activeProducts(shopId, [product.id]);
    const variant = listed?.variants.find((v) => v.stock > 0);
    if (!variant) throw new Error('The seeded product has no stock');
    const customer = await shop.customers.identify(shopId, 100 + index, 'Customer');
    const order = await shop.orders.create(
      shopId,
      {
        customerId: customer.id,
        items: [{ variantId: variant.id, quantity: item.sold }],
        delivery: { type: 'pickup' },
        paymentDeadline: new Date(Date.now() + 3_600_000),
      },
      'customer',
    );
    await shop.orders.transition(shopId, order.id, 'payment_submitted', 'customer', 'Receipt');
    await shop.orders.transition(shopId, order.id, 'payment_approved', 'system', 'Verified');
  }
}

function valuesOf(rows: Record<string, string | number | boolean | null>[]): Row[] {
  return rows.map((row) => Object.values(row));
}

/**
 * Measures the owner assistant on questions about the business: its one checked query returns
 * the same rows as a hand-written reference query, and a question about personal data gets none.
 */
export function ownerQuestionsSuite(db: Database): Suite {
  async function answer(
    { question, referenceSql }: z.output<typeof input>,
    model: LanguageModel,
  ): Promise<Actual> {
    const shop = createOwnerShop(db, model, () => NOW);
    const shopId = await shop.shops.create(OWNER.telegramUserId, { name: 'Evaluation shop' });
    await seed(shop, shopId);
    const answer = await shop.assistant.answer(shopId, OWNER, question);
    const run = shop.runs.at(-1);
    const results = run?.outcome === 'reply' ? run.toolResults : [];
    const queries = results.flatMap((result) => {
      if (result.status !== 'ok') return [];
      const parsed = askDataOutputSchema.safeParse(result.output);
      return parsed.success ? [parsed.data] : [];
    });
    const last = queries.at(-1);
    const reference = referenceSql
      ? valuesOf((await shop.reporting.ask(shopId, referenceSql)).rows)
      : null;
    return { rows: last ? valuesOf(last.rows) : null, reference, reply: answer.text };
  }

  return defineSuite({
    name: 'owner-questions',
    dataset: 'owner-questions.jsonl',
    input,
    expected,
    metrics: { sameRows: { atLeast: 0.85 } },
    run: answer,
    score: (actual, { expected: wanted }) => ({
      sameRows: wanted.refused
        ? Number(actual.rows === null)
        : Number(
            actual.rows !== null &&
              actual.reference !== null &&
              sameRows(actual.rows, actual.reference),
          ),
    }),
  });
}

/**
 * The same rows in the same order. A row may carry extra columns, such as the color next to a
 * sold-out size, as long as it holds every value of the reference row.
 */
function sameRows(rows: Row[], reference: Row[]): boolean {
  return (
    rows.length === reference.length &&
    reference.every((expectedRow, index) => {
      const values = (rows[index] ?? []).map(String);
      return expectedRow.every((value) => {
        const at = values.indexOf(String(value));
        if (at === -1) return false;
        values.splice(at, 1);
        return true;
      });
    })
  );
}
