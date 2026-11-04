export const errorStatus = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
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
