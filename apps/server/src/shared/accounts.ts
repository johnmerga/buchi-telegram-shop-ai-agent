/** Fewer visible digits than this could match many accounts by chance. */
const MIN_MATCHING_DIGITS = 4;

export interface PrintedReceiver {
  name: string | null;
  account: string | null;
}

export interface KnownAccount {
  accountName: string;
  accountNumber: string;
}

/**
 * Whether a receiver printed on a receipt or a bank page is this account. The account number
 * decides when enough of its digits are visible; otherwise the name decides.
 */
export function receiverMatches(printed: PrintedReceiver, known: KnownAccount): boolean {
  const byNumber =
    printed.account === null ? 'unknown' : compareNumbers(printed.account, known.accountNumber);
  if (byNumber !== 'unknown') return byNumber === 'match';
  return printed.name !== null && namesMatch(printed.name, known.accountName);
}

/**
 * The Telebirr app prints only the receiver's first name, which must be the account holder's
 * first name. It proves less than a full name, so callers treat it as weaker evidence.
 */
export function firstNameMatches(printed: string | null, known: KnownAccount): boolean {
  const shown = words(printed ?? '');
  return shown.length === 1 && shown[0] === words(known.accountName)[0];
}

/**
 * Compares the digits shown on each side of the mask. A mask can hide any number of digits, as in
 * "1****1199" for a 13-digit CBE account, and phone numbers come with or without the country
 * code, so the digits before the mask match the number's start and those after it its end.
 */
function compareNumbers(printed: string, known: string): 'match' | 'differ' | 'unknown' {
  const shown = printed.replace(/[xX•]/g, '*').replace(/[^0-9*]/g, '');
  const digits = localForm(known.replace(/\D/g, ''));
  const maskStart = shown.indexOf('*');
  const start = maskStart < 0 ? '' : localStart(shown.slice(0, maskStart));
  const end = maskStart < 0 ? localForm(shown) : shown.slice(shown.lastIndexOf('*') + 1);
  if (start.length + end.length > digits.length) return 'differ';
  if (!digits.startsWith(start) || !digits.endsWith(end)) return 'differ';
  return start.length + end.length >= MIN_MATCHING_DIGITS ? 'match' : 'unknown';
}

/** "251911234567" and "0911234567" are the same Ethiopian phone number. */
function localForm(number: string): string {
  return number.length === 12 && number.startsWith('251') ? `0${number.slice(3)}` : number;
}

/** The start of a masked phone number, such as "2519" in "2519****4567", as "09". */
function localStart(start: string): string {
  return start.startsWith('251') ? `0${start.slice(3)}` : start;
}

/**
 * Receipts print the account holder's full name, often in capitals, while shops may enter a
 * shorter form. Two or more words of the shorter name must all appear in the longer one.
 */
function namesMatch(a: string, b: string): boolean {
  const [first, second] = [words(a), words(b)];
  const [shorter, longer] = first.length <= second.length ? [first, second] : [second, first];
  if (shorter.length < 2) return shorter.length === longer.length && shorter[0] === longer[0];
  return shorter.every((word) => longer.includes(word));
}

function words(name: string): string[] {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
