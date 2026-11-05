import { z } from 'zod';

/** An amount in birr with at most two decimals, sent as a string such as "12.23". */
export const moneySchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Use birr with at most two decimals, such as "12.23".');
export type MoneyString = z.infer<typeof moneySchema>;

/**
 * An exact birr amount. It counts hundredths internally, so arithmetic never passes through
 * JavaScript floating-point numbers, and it always prints two decimals, such as "100.00".
 */
export class Money {
  private constructor(private readonly hundredths: bigint) {}

  static readonly zero = new Money(0n);

  static of(amount: MoneyString): Money {
    const [birr = '0', fraction = ''] = moneySchema.parse(amount).split('.');
    return new Money(BigInt(birr) * 100n + BigInt(fraction.padEnd(2, '0')));
  }

  add(other: Money): Money {
    return new Money(this.hundredths + other.hundredths);
  }

  /** Amounts are never negative, so subtracting a larger amount is a programming error. */
  subtract(other: Money): Money {
    if (other.hundredths > this.hundredths) throw new RangeError('Money cannot be negative');
    return new Money(this.hundredths - other.hundredths);
  }

  times(quantity: number): Money {
    if (!Number.isInteger(quantity)) throw new RangeError('Quantity must be a whole number');
    return new Money(this.hundredths * BigInt(quantity));
  }

  /** Rounds up to the next cent, so a share of an amount is never smaller than the exact share. */
  divideRoundingUp(divisor: number): Money {
    if (!Number.isInteger(divisor) || divisor < 1) {
      throw new RangeError('Divisor must be a positive whole number');
    }
    return new Money(ceilDiv(this.hundredths, BigInt(divisor)));
  }

  /** Rounds up to a multiple of `step`, such as the next 50 birr. */
  roundUpTo(step: Money): Money {
    if (step.hundredths === 0n) throw new RangeError('Step must be positive');
    return new Money(ceilDiv(this.hundredths, step.hundredths) * step.hundredths);
  }

  compare(other: Money): -1 | 0 | 1 {
    if (this.hundredths === other.hundredths) return 0;
    return this.hundredths < other.hundredths ? -1 : 1;
  }

  toString(): MoneyString {
    const birr = this.hundredths / 100n;
    const fraction = (this.hundredths % 100n).toString().padStart(2, '0');
    return `${birr.toString()}.${fraction}`;
  }
}

function ceilDiv(dividend: bigint, divisor: bigint): bigint {
  return (dividend + divisor - 1n) / divisor;
}

/** Formats an amount the way Ethiopian shops write it, such as "3,500.00 ብር". */
export function formatBirr(amount: MoneyString): string {
  const [birr = '0', fraction = '00'] = Money.of(amount).toString().split('.');
  return `${birr.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction} ብር`;
}
