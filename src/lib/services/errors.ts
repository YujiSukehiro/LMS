/**
 * Error with an HTTP status, a machine code and a plain-English message.
 * Services throw it; route handlers convert it to an ApiErrorBody with `jsonError`.
 */
export class ServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
