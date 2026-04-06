// models/todo.model.ts
import { z } from 'zod';

// Zod schemas — single source of truth for validation AND types
export const createTodoSchema = z.object({
  title:    z.string().min(1, 'Title is required').max(200),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  dueDate:  z.string().datetime({ message: 'Must be ISO 8601' }).optional(),
});

export const updateTodoSchema = z.object({
  title:    z.string().min(1).max(200).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  status:   z.enum(['pending', 'done']).optional(),
  dueDate:  z.string().datetime().optional(),
}).refine(
  data => Object.keys(data).length > 0,
  { message: 'At least one field required for PATCH' }
);

// Derive TypeScript types directly from Zod schemas — no duplication
export type CreateTodoDto = z.infer<typeof createTodoSchema>;
export type UpdateTodoDto = z.infer<typeof updateTodoSchema>;

// Full Todo type (includes server-generated fields)
export interface Todo {
  id:        string;
  title:     string;
  status:    'pending' | 'done';
  priority:  'high' | 'medium' | 'low';
  dueDate?:  string;
  createdAt: string;
  updatedAt: string;
}