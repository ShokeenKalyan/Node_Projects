// middleware/validate.ts
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from '../utils/errors';

export const validate = (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    // Validate and coerce request body according to the provided Zod schema
    // Zod schem - a will handle type coercion (e.g., string to number) if configured, so we can directly use the parsed data
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Flatten Zod errors into a readable structure
      return next(new AppError(400, 'Validation failed', result.error.flatten()));
    }
    req.body = result.data;  // replace with coerced, validated data
    next();
  };