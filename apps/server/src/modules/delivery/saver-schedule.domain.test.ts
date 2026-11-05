import { describe, expect, it } from 'vitest';
import { nextSaverRun } from './saver-schedule.domain';

/** 09:30 in Addis Ababa is 06:30 UTC. */
const morning = new Date('2026-11-05T06:30:00Z');

describe('nextSaverRun', () => {
  it('picks the next run time later today in Addis Ababa', () => {
    expect(nextSaverRun(['14:00', '10:00'], morning)).toEqual(new Date('2026-11-05T07:00:00Z'));
  });

  it('moves to tomorrow once every run time today has passed', () => {
    const evening = new Date('2026-11-05T15:00:00Z');
    expect(nextSaverRun(['10:00', '14:00'], evening)).toEqual(new Date('2026-11-06T07:00:00Z'));
  });

  it('never returns the current minute, so a run cannot schedule itself again', () => {
    const tenOClock = new Date('2026-11-05T07:00:00Z');
    expect(nextSaverRun(['10:00'], tenOClock)).toEqual(new Date('2026-11-06T07:00:00Z'));
  });

  it('handles a run time after midnight in Addis Ababa but before midnight UTC', () => {
    const lateEvening = new Date('2026-11-05T20:30:00Z');
    expect(nextSaverRun(['00:30'], lateEvening)).toEqual(new Date('2026-11-05T21:30:00Z'));
  });

  it('returns nothing without run times', () => {
    expect(nextSaverRun([], morning)).toBeUndefined();
  });
});
