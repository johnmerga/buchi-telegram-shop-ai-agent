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
 * Compares from the last digit backwards, because receipts mask middle digits ("2519****4567")
 * and write phone numbers with or without the country code.
 */
function compareNumbers(printed: string, known: string): 'match' | 'differ' | 'unknown' {
  const shown = localForm(printed.replace(/[xX•]/g, '*').replace(/[^0-9*]/g, ''));
  const digits = localForm(known.replace(/\D/g, ''));
  let compared = 0;
  for (let i = 1; i <= Math.min(shown.length, digits.length); i += 1) {
    const char = shown[shown.length - i];
    if (char === '*') continue;
    if (char !== digits[digits.length - i]) return 'differ';
    compared += 1;
  }
  return compared >= MIN_MATCHING_DIGITS ? 'match' : 'unknown';
}

/** "251911234567" and "0911234567" are the same Ethiopian phone number. */
function localForm(number: string): string {
  return number.length === 12 && number.startsWith('251') ? `0${number.slice(3)}` : number;
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
