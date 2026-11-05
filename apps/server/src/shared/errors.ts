export const errorStatus = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  QUOTA_EXHAUSTED: 503,
  /** An external service failed, so the request can succeed later. */
  UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof errorStatus;

/** An expected failure with a stable code that clients can rely on. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get status(): number {
    return errorStatus[this.code];
  }
}
