/**
 * The part of the day an Amharic speaker names with a time: ጠዋት (morning), ከሰዓት (afternoon),
 * ማታ or ምሽት (evening), and ሌሊት (night).
 */
type DayPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

/** An hour on the Ethiopian clock, which counts 1 to 12 from 6:00 and again from 18:00. */
interface EthiopianTime {
  hour: number;
  minute: number;
  period?: DayPeriod | undefined;
}

/** A time of day on the 24-hour clock, and whether it falls after midnight of the named day. */
interface WesternTime {
  hour: number;
  minute: number;
  nextDay: boolean;
}

const OFFSET_HOURS = 6;

/**
 * Converts the Ethiopian clock to the 24-hour clock: the Ethiopian hour is the Western hour minus
 * six, so ከ10 ሰዓት is 16:00. Without a period word the time is in the daytime half, as owners
 * mean by "10 ሰዓት". ማታ and ሌሊት are the night half; a ሌሊት time after midnight belongs to the
 * night that follows the named day, so "ሌሊት 10 ሰዓት" on Friday is 4:00 on Saturday.
 */
export function westernTime(time: EthiopianTime): WesternTime {
  if (!Number.isInteger(time.hour) || time.hour < 1 || time.hour > 12) {
    throw new RangeError('An Ethiopian hour is a whole number from 1 to 12');
  }
  const night = time.period === 'evening' || time.period === 'night';
  const hour = ((time.hour % 12) + OFFSET_HOURS + (night ? 12 : 0)) % 24;
  return { hour, minute: time.minute, nextDay: night && hour < OFFSET_HOURS };
}

const periodWords: { from: number; word: string }[] = [
  { from: 0, word: 'ከሌሊቱ' },
  { from: 6, word: 'ከጠዋቱ' },
  { from: 12, word: 'ከቀኑ' },
  { from: 18, word: 'ከምሽቱ' },
];

/** How an Amharic speaker says a 24-hour time, such as "ከቀኑ 10 ሰዓት" for 16:00. */
export function ethiopianClockText(hour: number, minute: number): string {
  const word = periodWords.findLast((period) => hour >= period.from)?.word ?? 'ከሌሊቱ';
  const ethiopianHour = (hour + OFFSET_HOURS) % 12 || 12;
  const minutes = minute === 0 ? '' : `:${String(minute).padStart(2, '0')}`;
  return `${word} ${String(ethiopianHour)}${minutes} ሰዓት`;
}
