import { Router } from 'express';
import { requireSecretHeader } from '../../http/middleware/require-secret-header';
import type { JobService } from './jobs.service';

export function createJobsRouter(jobs: JobService, jobSecret: string): Router {
  const router = Router();
  router.use('/jobs', requireSecretHeader('x-job-secret', jobSecret));
  router.post('/jobs/:name', async (req, res) => {
    res.json(await jobs.run(req.params.name));
  });
  return router;
}
