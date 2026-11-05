import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectDatabase } from '../../src/db/client';
import { timers } from '../../src/db/schema';
import { TimersRepo } from '../../src/modules/jobs/timers.repo';
import { TimerService } from '../../src/modules/jobs/timers.service';
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

    expect(await service.tick()).toEqual({ done: 2, failed: 1 });

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

    expect(await service.tick()).toEqual({ done: 0, failed: 1 });
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
});
