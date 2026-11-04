import express from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/http/app';
import { errorHandler } from '../src/http/middleware/errors';
import { createJobsRouter } from '../src/modules/jobs/jobs.routes';
import { JobService } from '../src/modules/jobs/jobs.service';
import { AppError } from '../src/shared/errors';

const logger = pino({ level: 'silent' });
const jobSecret = 'test-job-secret-that-is-long-enough';

function testApp() {
  const jobs = new JobService(new Map([['tick', () => Promise.resolve({ done: 2, failed: 1 })]]));
  return createApp({ logger, routers: [createJobsRouter(jobs, jobSecret)] });
}

describe('createApp', () => {
  it('reports health', async () => {
    const res = await request(testApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('returns NOT_FOUND for unknown routes, with a request ID', async () => {
    const res = await request(testApp()).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});

describe('job endpoints', () => {
  it('rejects a request without the job secret', async () => {
    const res = await request(testApp()).post('/jobs/tick');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
  });

  it('rejects a request with a wrong job secret', async () => {
    const res = await request(testApp()).post('/jobs/tick').set('x-job-secret', 'wrong');
    expect(res.status).toBe(401);
  });

  it('runs the tick and returns its summary', async () => {
    const res = await request(testApp()).post('/jobs/tick').set('x-job-secret', jobSecret);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ done: 2, failed: 1 });
  });

  it('returns NOT_FOUND for an unknown job name', async () => {
    const res = await request(testApp()).post('/jobs/nope').set('x-job-secret', jobSecret);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('errorHandler', () => {
  function appThatThrows(error: unknown) {
    const app = express();
    app.use((req, _res, next) => {
      req.log = logger;
      next();
    });
    app.get('/', () => {
      throw error;
    });
    app.use(errorHandler);
    return app;
  }

  it('maps an AppError code to its status', async () => {
    const res = await request(appThatThrows(new AppError('CONFLICT', 'Already taken'))).get('/');
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'CONFLICT', message: 'Already taken' } });
  });

  it('hides details of unexpected errors', async () => {
    const res = await request(appThatThrows(new Error('secret detail'))).get('/');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret detail');
  });
});
