// middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';

export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction   // must declare all 4 params — see interview note
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error:   err.message,
      details: err.details ?? undefined,
    });
  }

  // Unhandled / unexpected error — never leak stack traces
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: 'Internal server error' });
};