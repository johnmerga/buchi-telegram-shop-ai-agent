import { eq, sql } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { timers } from '../../src/db/schema';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TICK_BATCH_SIZE, TimerService } from '../../src/modules/jobs/timers.service';
import { testDatabaseUrl } from './test-database';

const { db, close } = connectDatabase(testDatabaseUrl);
const logger = pino({ level: 'silent' });
const past = new Date(Date.now() - 60_000);
const future = new Date(Date.now() + 3_600_000);

function createService(): TimerService {
  return new TimerService(new TimersRepo(db), logger);
}

function schedule(service: TimerService, kind: string, targetId: string, dueAt: Date) {
  return db.transaction((tx) => service.schedule(tx, kind, targetId, null, dueAt));
}

/** Makes a timer look claimed by a tick that crashed `minutesAgo` minutes ago. */
async function strand(id: string, attempts: number, minutesAgo: number) {
  await db
    .update(timers)
    .set({
      status: 'running',
      attempts,
      updatedAt: sql`now() - ${minutesAgo}::int * interval '1 minute'`,
    })
    .where(eq(timers.id, id));
}

async function statusOf(id: string) {
  const [row] = await db.select().from(timers).where(eq(timers.id, id));
  return row;
}

beforeEach(async () => {
  await db.delete(timers);
});

afterAll(close);

describe('timers', () => {
  it('never runs the same timer twice when two ticks run at once', async () => {
    const service = createService();
    const handler = vi.fn((_timer: { id: string }) => Promise.resolve());
    service.register('test', handler);
    const scheduled = await Promise.all(
      Array.from({ length: 20 }, (_, i) => schedule(service, 'test', `target-${String(i)}`, past)),
    );

    const [first, second] = await Promise.all([service.tick(), service.tick()]);

    const ranIds = handler.mock.calls.map(([timer]) => timer.id).sort();
    expect(ranIds).toEqual(scheduled.map((timer) => timer.id).sort());
    expect(first.done + second.done).toBe(20);
  });

  it('marks a failing timer failed and still completes the others', async () => {
    const service = createService();
    service.register('ok', () => Promise.resolve());
    service.register('boom', () => Promise.reject(new Error('handler exploded')));
    const ok1 = await schedule(service, 'ok', 'a', past);
    const boom = await schedule(service, 'boom', 'b', past);
    const ok2 = await schedule(service, 'ok', 'c', past);

    expect(await service.tick()).toEqual({ requeued: 0, done: 2, failed: 1 });

    expect(await statusOf(boom.id)).toMatchObject({
      status: 'failed',
      lastError: 'handler exploded',
      attempts: 1,
    });
    expect(await statusOf(ok1.id)).toMatchObject({ status: 'done', lastError: null });
    expect(await statusOf(ok2.id)).toMatchObject({ status: 'done' });
  });

  it('fails a timer whose kind has no handler', async () => {
    const service = createService();
    const orphan = await schedule(service, 'unknown', 'a', past);

    expect(await service.tick()).toEqual({ requeued: 0, done: 0, failed: 1 });
    expect(await statusOf(orphan.id)).toMatchObject({
      status: 'failed',
      lastError: 'No timer handler for "unknown"',
    });
  });

  it('claims only pending timers that are due', async () => {
    const service = createService();
    const handler = vi.fn((_timer: { id: string }) => Promise.resolve());
    service.register('test', handler);
    const due = await schedule(service, 'test', 'due', past);
    const notDue = await schedule(service, 'test', 'not-due', future);
    const finished = await schedule(service, 'test', 'finished', past);
    await db.update(timers).set({ status: 'done' }).where(eq(timers.id, finished.id));

    await service.tick();
    await service.tick();

    expect(handler.mock.calls.map(([timer]) => timer.id)).toEqual([due.id]);
    expect(await statusOf(notDue.id)).toMatchObject({ status: 'pending', attempts: 0 });
  });

  it('runs again a timer whose tick crashed after its lease ran out', async () => {
    const service = createService();
    const handler = vi.fn((_timer: { id: string }) => Promise.resolve());
    service.register('test', handler);
    const stuck = await schedule(service, 'test', 'a', past);
    await strand(stuck.id, 1, 11);

    expect(await service.tick()).toEqual({ requeued: 1, done: 1, failed: 0 });

    expect(handler).toHaveBeenCalledOnce();
    expect(await statusOf(stuck.id)).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('leaves a running timer alone while its lease lasts', async () => {
    const service = createService();
    const handler = vi.fn(() => Promise.resolve());
    service.register('test', handler);
    const running = await schedule(service, 'test', 'a', past);
    await strand(running.id, 1, 5);

    expect(await service.tick()).toEqual({ requeued: 0, done: 0, failed: 0 });

    expect(handler).not.toHaveBeenCalled();
    expect(await statusOf(running.id)).toMatchObject({ status: 'running', attempts: 1 });
  });

  it('fails a stuck timer that already used its last attempt', async () => {
    const service = createService();
    const handler = vi.fn(() => Promise.resolve());
    service.register('test', handler);
    const stuck = await schedule(service, 'test', 'a', past);
    await strand(stuck.id, 3, 11);

    expect(await service.tick()).toEqual({ requeued: 0, done: 0, failed: 1 });

    expect(handler).not.toHaveBeenCalled();
    expect(await statusOf(stuck.id)).toMatchObject({
      status: 'failed',
      attempts: 3,
      lastError: 'Interrupted 3 times',
    });
  });

  it('ignores the result of a claim whose timer was claimed again', async () => {
    const repo = new TimersRepo(db);
    const service = createService();
    const timer = await schedule(service, 'test', 'a', past);
    const [firstClaim] = await repo.claimDue(1);
    await strand(timer.id, 1, 11);
    await repo.reclaimStuck(10 * 60_000, 3);
    const [secondClaim] = await repo.claimDue(1);
    if (firstClaim === undefined || secondClaim === undefined) throw new Error('Nothing claimed');

    await repo.markFailed(firstClaim, 'late result');

    expect(await statusOf(timer.id)).toMatchObject({ status: 'running', attempts: 2 });
    await repo.markDone(secondClaim);
    expect(await statusOf(timer.id)).toMatchObject({ status: 'done', lastError: 'Interrupted' });
  });

  it('runs a pending timer behind more failed timers than one tick claims', async () => {
    const service = createService();
    const handler = vi.fn((_timer: { id: string }) => Promise.resolve());
    service.register('test', handler);
    const longAgo = new Date(Date.now() - 3_600_000);
    await db.insert(timers).values(
      Array.from({ length: TICK_BATCH_SIZE + 10 }, (_, i) => ({
        kind: 'test',
        targetId: `failed-${String(i)}`,
        dueAt: longAgo,
        status: 'failed' as const,
        attempts: 1,
      })),
    );
    const pending = await schedule(service, 'test', 'pending', past);

    expect(await service.tick()).toEqual({ requeued: 0, done: 1, failed: 0 });
    expect(handler.mock.calls.map(([timer]) => timer.id)).toEqual([pending.id]);
  });

  it('drains 1,000 due timers in batches, running each once, with ticks running at once', async () => {
    const service = createService();
    const handler = vi.fn((_timer: { id: string }) => Promise.resolve());
    service.register('test', handler);
    const total = 1_000;
    await db.insert(timers).values(
      Array.from({ length: total }, (_, i) => ({
        kind: 'test',
        targetId: `load-${String(i)}`,
        dueAt: new Date(past.getTime() - i * 1_000),
      })),
    );

    const summaries = [];
    for (;;) {
      const round = await Promise.all([service.tick(), service.tick(), service.tick()]);
      summaries.push(...round);
      if (round.every((summary) => summary.done === 0)) break;
    }

    for (const summary of summaries) expect(summary.done).toBeLessThanOrEqual(TICK_BATCH_SIZE);
    const ranIds = handler.mock.calls.map(([timer]) => timer.id);
    expect(ranIds).toHaveLength(total);
    expect(new Set(ranIds).size).toBe(total);
    const [left] = await db
      .select({ count: sql<number>`count(*) filter (where ${timers.status} <> 'done')::int` })
      .from(timers);
    expect(left?.count).toBe(0);
  });
});
