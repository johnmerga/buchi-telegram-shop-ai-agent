import { createHmac } from 'node:crypto';

/** The design doc's rule: signals from this many shops make a payer high risk. */
const HIGH_RISK_SHOP_COUNT = 2;
/** Ethiopian mobile numbers end in nine digits, whether written with +251, 251, or 0. */
const PHONE_DIGITS = 9;

export interface Payer {
  telegramUserId: number;
  phone: string | null;
}

/**
 * One keyed hash for each identifier, so a payer is recognised by their Telegram account or their
 * phone number. Without the secret, a hash cannot be traced back to the person.
 */
export function payerKeys(secret: string, payer: Payer): string[] {
  const identifiers = [`telegram:${String(payer.telegramUserId)}`];
  const digits = payer.phone?.replace(/\D/g, '') ?? '';
  if (digits.length >= PHONE_DIGITS) identifiers.push(`phone:${digits.slice(-PHONE_DIGITS)}`);
  return identifiers.map((id) => createHmac('sha256', secret).update(id).digest('hex'));
}

export function isHighRisk(shopsWithSignals: number): boolean {
  return shopsWithSignals >= HIGH_RISK_SHOP_COUNT;
}
