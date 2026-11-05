/** What the bank's public receipt page said about a transaction reference (layer 3). */
export const bankChecks = ['CONFIRMED', 'NOT_FOUND', 'MISMATCH', 'UNAVAILABLE'] as const;
export type BankCheck = (typeof bankChecks)[number];
