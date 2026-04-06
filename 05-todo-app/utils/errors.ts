export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    // Fixes prototype chain in TypeScript when extending Error
    Object.setPrototypeOf(this, AppError.prototype);
  }
}