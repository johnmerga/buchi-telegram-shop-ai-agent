import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { ownerRules } from '../../db/schema';
import type { RuleType } from './rules.schemas';

type NewRule = typeof ownerRules.$inferInsert;

export class OwnerRulesRepo {
  async insert(tx: Transaction, rule: NewRule): Promise<string> {
    const [row] = await tx.insert(ownerRules).values(rule).returning({ id: ownerRules.id });
    if (!row) throw new Error('Insert returned no owner rule');
    return row.id;
  }

  /** The parameters of every rule of one type that is in force at `at`. */
  async activeParameters(tx: Transaction, type: RuleType, at: Date): Promise<unknown[]> {
    const rows = await tx
      .select({ parameters: ownerRules.parameters })
      .from(ownerRules)
      .where(
        and(
          eq(ownerRules.type, type),
          lte(ownerRules.startsAt, at),
          or(isNull(ownerRules.endsAt), gt(ownerRules.endsAt, at)),
        ),
      );
    return rows.map((row) => row.parameters);
  }
}
