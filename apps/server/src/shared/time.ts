const addisClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Addis_Ababa',
  hour: '2-digit',
  minute: '2-digit',
});

/** A time of day in Addis Ababa, such as "18:30", for messages about today. */
export function addisClockTime(date: Date): string {
  return addisClock.format(date);
}
