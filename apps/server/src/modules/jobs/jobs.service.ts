import { AppError } from '../../shared/errors';

/** A scheduled job. It returns a small summary of counts for the caller. */
export type Job = () => Promise<Record<string, number>>;

/** Runs jobs by name, as the cron service requests them. */
export class JobService {
  constructor(private readonly jobs: ReadonlyMap<string, Job>) {}

  run(name: string): Promise<Record<string, number>> {
    const job = this.jobs.get(name);
    if (job === undefined) {
      throw new AppError('NOT_FOUND', `No job named "${name}"`);
    }
    return job();
  }
}
