/**
 * Demo customers and drivers have made-up Telegram user IDs from this number up. Real user IDs are
 * far below it, so the bot can tell demo people apart and never sends them anything.
 */
export const DEMO_TELEGRAM_ID_BASE = 9_000_000_000_000;

/** The made-up Telegram user ID of the demo person with this index. */
export function demoTelegramId(index: number): number {
  return DEMO_TELEGRAM_ID_BASE + index;
}

export function isDemoTelegramId(id: number): boolean {
  return id >= DEMO_TELEGRAM_ID_BASE;
}
