import { createHash } from 'node:crypto';

/**
 * A UUID derived from a case key, because IDs appear in what the model reads, and a recorded
 * request must hash the same on every run.
 */
export function caseUuid(caseKey: string): string {
  const hex = createHash('sha256').update(caseKey).digest('hex');
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
