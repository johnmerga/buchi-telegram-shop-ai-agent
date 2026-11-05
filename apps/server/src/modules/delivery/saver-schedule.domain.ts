/** Addis Ababa keeps UTC+3 all year, without daylight saving time. */
const ADDIS_ABABA_OFFSET_MS = 3 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * The first Saver run strictly after `after`, from Addis Ababa times of day such as "14:00", or
 * nothing when the shop has no run times.
 */
export function nextSaverRun(times: string[], after: Date): Date | undefined {
  const localNow = after.getTime() + ADDIS_ABABA_OFFSET_MS;
  const localMidnight = Math.floor(localNow / DAY_MS) * DAY_MS;
  const runs = times.map((time) => {
    const today = localMidnight + minutesOfDay(time) * 60_000;
    return (today > localNow ? today : today + DAY_MS) - ADDIS_ABABA_OFFSET_MS;
  });
  return runs.length > 0 ? new Date(Math.min(...runs)) : undefined;
}

/** "14:05" is 845 minutes after midnight. The API schema guarantees the format. */
function minutesOfDay(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}
