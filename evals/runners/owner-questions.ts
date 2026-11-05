import { Money } from '@buchi/shared';
import { askDataOutputSchema } from '@buchi/server/ai/agents/owner-assistant/tools/ask-data';
import type { LanguageModel } from '@buchi/server/ai/language-model';
import type { Database } from '@buchi/server/db/client';
import { customers, orderItems, orders, products, productVariants } from '@buchi/server/db/schema';
import { withShop } from '@buchi/server/db/with-shop';
import { z } from 'zod';
import { caseUuid } from '../harness/case-uuid';
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

/**
 * The same small shop for every case: two shoes sold, one size sold out, one shoe never sold.
 * IDs are fixed per case, because query results show them to the model and recordings match on
 * the request. Sales are an hour old, so "last 7 days" questions see them.
 */
async function seed(db: Database, shopId: string, caseKey: string): Promise<void> {
  const id = (role: string) => caseUuid(`${caseKey}:${role}`);
  const sales = [
    { title: 'Nike Air', price: '3500.00', stock: { '42': 7, '43': 0 }, sold: 3 },
    { title: 'Adidas Samba', price: '3200.00', stock: { '41': 4 }, sold: 1 },
    { title: 'Puma Suede', price: '2800.00', stock: { '40': 6 }, sold: 0 },
  ];
  const soldAt = new Date(Date.now() - 3_600_000);
  await withShop(db, shopId, async (tx) => {
    for (const [index, item] of sales.entries()) {
      const productId = id(item.title);
      await tx.insert(products).values({
        id: productId,
        shopId,
        title: item.title,
        pricingMode: 'fixed',
        price: item.price,
      });
      const sizes = Object.entries(item.stock);
      await tx.insert(productVariants).values(
        sizes.map(([size, stock]) => ({
          id: id(`${item.title}:${size}`),
          shopId,
          productId,
          size,
          stock,
        })),
      );
      const [size] = sizes[0] ?? [];
      if (item.sold === 0 || size === undefined) continue;
      const customerId = id(`customer:${String(index)}`);
      await tx
        .insert(customers)
        .values({ id: customerId, shopId, telegramUserId: 100 + index, name: 'Customer' });
      const total = Money.of(item.price).times(item.sold).toString();
      const orderId = id(`order:${String(index)}`);
      await tx.insert(orders).values({
        id: orderId,
        shopId,
        customerId,
        status: 'paid',
        deliveryType: 'pickup',
        itemsTotal: total,
        deliveryFee: '0.00',
        total,
        createdAt: soldAt,
      });
      await tx.insert(orderItems).values({
        shopId,
        orderId,
        variantId: id(`${item.title}:${size}`),
        quantity: item.sold,
        unitPrice: item.price,
      });
    }
  });
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
    await seed(db, shopId, question);
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
