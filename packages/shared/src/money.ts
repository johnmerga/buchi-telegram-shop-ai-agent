import { z } from 'zod';

/** An amount in birr with at most two decimals, sent as a string such as "12.23". */
export const moneySchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use birr with at most two decimals, such as "12.23".');
export type MoneyString = z.infer<typeof moneySchema>;
