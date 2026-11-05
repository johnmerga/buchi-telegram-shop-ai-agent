const addisClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Addis_Ababa',
  hour: '2-digit',
  minute: '2-digit',
});

/** Ethiopia has no daylight saving time, so Addis Ababa is always three hours ahead of UTC. */
const ADDIS_OFFSET_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** A time of day in Addis Ababa, such as "18:30", for messages about today. */
export function addisClockTime(date: Date): string {
  return addisClock.format(date);
}

/** A date and time in Addis Ababa as a spreadsheet reads it, such as "2026-11-05 18:30". */
export function addisDateTime(date: Date): string {
  return new Date(date.getTime() + ADDIS_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}

/** The Addis Ababa calendar day that `date` falls on, with its start and end as instants. */
export interface AddisDay {
  /** Such as "2026-11-05". */
  day: string;
  start: Date;
  end: Date;
}

export function addisDay(date: Date): AddisDay {
  const local = date.getTime() + ADDIS_OFFSET_MS;
  const startOfLocalDay = local - (local % DAY_MS);
  return {
    day: new Date(startOfLocalDay).toISOString().slice(0, 10),
    start: new Date(startOfLocalDay - ADDIS_OFFSET_MS),
    end: new Date(startOfLocalDay - ADDIS_OFFSET_MS + DAY_MS),
  };
}

/** The instant of a time of day on an Addis Ababa date such as "2026-11-05". Hours past 23 roll over. */
export function addisInstant(day: string, hour: number, minute: number): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) + (hour * 60 + minute) * 60_000 - ADDIS_OFFSET_MS);
}
