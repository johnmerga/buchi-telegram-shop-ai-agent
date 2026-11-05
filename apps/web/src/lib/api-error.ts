import { z } from 'zod';

const errorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** A failed API call with the server's error code, such as FORBIDDEN or CONFLICT. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function readError(res: Response): Promise<ApiError> {
  const body = errorBodySchema.safeParse(await res.json().catch(() => undefined));
  return body.success
    ? new ApiError(res.status, body.data.error.code, body.data.error.message)
    : new ApiError(res.status, 'INTERNAL', 'Something went wrong. Try again.');
}
