# Todo REST API — Complete Reference Guide

> **Context:** GoDaddy Senior Backend Engineer Interview Prep  
> **Topic:** Implementing a production-quality REST API in Node.js + TypeScript  
> **Key message:** This question is not about todos. It's a canvas for demonstrating API design, layered architecture, validation, and error handling.

---

## Table of Contents

1. [API Contract — Define First](#1-api-contract--define-first)
2. [Data Model](#2-data-model)
3. [Project Structure — Layered Architecture](#3-project-structure--layered-architecture)
4. [The Layering Rule](#4-the-layering-rule)
5. [Full Implementation — Every File](#5-full-implementation--every-file)
   - [models/todo.model.ts](#51-modelstodomodelts)
   - [utils/errors.ts](#52-utilserrorsts)
   - [repositories/todo.repository.ts](#53-repositoriestodorepositorysts)
   - [services/todo.service.ts](#54-servicestodoservicets)
   - [middleware/validate.ts](#55-middlewarevalidatets)
   - [middleware/errorHandler.ts](#56-middlewareerrorhandlerts)
   - [middleware/notFound.ts](#57-middlewarenotfoundts)
   - [controllers/todo.controller.ts](#58-controllerstodocontrollerts)
   - [routes/todo.routes.ts](#59-routestodoroutests)
   - [app.ts](#510-appts)
   - [server.ts](#511-serverts)
6. [Complete Request Lifecycle](#6-complete-request-lifecycle)
7. [HTTP Status Codes — Used Correctly](#7-http-status-codes--used-correctly)
8. [Key Design Decisions & Interview Talking Points](#8-key-design-decisions--interview-talking-points)
9. [Senior-Level Add-ons to Mention](#9-senior-level-add-ons-to-mention)
10. [Common Interview Follow-up Questions](#10-common-interview-follow-up-questions)

---

## 1. API Contract — Define First

**Always state the contract before writing any code. This is the senior signal.**

| Method   | Path         | Request Body                             | Success | Error        |
|----------|--------------|------------------------------------------|---------|--------------|
| `GET`    | `/todos`     | —                                        | 200     | —            |
| `POST`   | `/todos`     | `{ title, priority?, dueDate? }`         | 201     | 400          |
| `GET`    | `/todos/:id` | —                                        | 200     | 404          |
| `PATCH`  | `/todos/:id` | `{ title?, priority?, status?, dueDate?}`| 200     | 400, 404     |
| `DELETE` | `/todos/:id` | —                                        | 204     | 404          |

**Query parameters on `GET /todos`:**
- `?status=pending|done` — filter by status
- `?priority=high|medium|low` — filter by priority

---

## 2. Data Model

```typescript
interface Todo {
  id:        string;           // crypto.randomUUID()
  title:     string;           // 1–200 chars
  status:    'pending' | 'done';
  priority:  'high' | 'medium' | 'low';
  dueDate?:  string;           // ISO 8601 datetime string
  createdAt: string;           // ISO 8601, set on creation
  updatedAt: string;           // ISO 8601, updated on every PATCH
}
```

---

## 3. Project Structure — Layered Architecture

```
src/
├── app.ts                      ← Express app setup, middleware registration
├── server.ts                   ← HTTP server bootstrap, graceful shutdown
│
├── models/
│   └── todo.model.ts           ← Interfaces + Zod schemas (single source of truth)
│
├── routes/
│   └── todo.routes.ts          ← Route definitions only — no logic
│
├── controllers/
│   └── todo.controller.ts      ← Parse req, call service, send res
│
├── services/
│   └── todo.service.ts         ← Business rules & orchestration
│
├── repositories/
│   └── todo.repository.ts      ← Data access only (Map or DB)
│
├── middleware/
│   ├── validate.ts             ← Zod schema validation factory
│   ├── errorHandler.ts         ← Centralised 4-arg error handler
│   └── notFound.ts             ← 404 catch-all
│
└── utils/
    └── errors.ts               ← AppError class with statusCode
```

---

## 4. The Layering Rule

```
Routes        →  knows HTTP verbs and paths only
Controller    →  parses req/res, calls service, formats response
Service       →  business logic, rules, orchestration — no Express imports
Repository    →  data access only, no business logic
```

**Why this matters:**
- Swapping the database only touches the repository — controller and service unchanged
- Business rules are testable in isolation (mock the repository)
- Controllers are thin and uniform — no logic leaks into them
- Middleware stays reusable across routes

---

## 5. Full Implementation — Every File

### 5.1 `models/todo.model.ts`

```typescript
import { z } from 'zod';

// Zod schemas — single source of truth for validation AND TypeScript types
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

// Derive TypeScript types from Zod schemas — no duplication
export type CreateTodoDto = z.infer<typeof createTodoSchema>;
export type UpdateTodoDto = z.infer<typeof updateTodoSchema>;

// Full Todo shape including server-generated fields
export interface Todo {
  id:        string;
  title:     string;
  status:    'pending' | 'done';
  priority:  'high' | 'medium' | 'low';
  dueDate?:  string;
  createdAt: string;
  updatedAt: string;
}
```

**Key concept:** `z.infer<typeof schema>` derives the TypeScript type directly from the Zod schema. No need to maintain a separate interface for DTOs — Zod is the single source of truth.

---

### 5.2 `utils/errors.ts`

```typescript
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
    // IMPORTANT: fixes instanceof check when targeting ES5 in TypeScript
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
```

**Key concept:** `Object.setPrototypeOf` is required in TypeScript when extending built-in classes like `Error`. Without it, `err instanceof AppError` can return `false` at runtime when compiling to ES5, silently breaking the error handler.

---

### 5.3 `repositories/todo.repository.ts`

```typescript
import { randomUUID } from 'crypto';
import { Todo } from '../models/todo.model';

// In-memory store — swap this Map for Prisma/TypeORM without touching any other layer
const store = new Map<string, Todo>();

export const todoRepo = {
  findAll(filter?: Partial<Pick<Todo, 'status' | 'priority'>>): Todo[] {
    let todos = [...store.values()];
    if (filter?.status)   todos = todos.filter(t => t.status   === filter.status);
    if (filter?.priority) todos = todos.filter(t => t.priority === filter.priority);
    return todos.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
  },

  findById(id: string): Todo | undefined {
    return store.get(id);
  },

  create(data: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>): Todo {
    const now = new Date().toISOString();
    const todo: Todo = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
    store.set(todo.id, todo);
    return todo;
  },

  update(id: string, patch: Partial<Todo>): Todo | undefined {
    const existing = store.get(id);
    if (!existing) return undefined;
    const updated: Todo = {
      ...existing,
      ...patch,
      id,                                       // prevent id overwrite
      updatedAt: new Date().toISOString(),      // always refresh updatedAt
    };
    store.set(id, updated);
    return updated;
  },

  delete(id: string): boolean {
    return store.delete(id);
  },
};
```

**Key concept:** The repository has zero business logic. It does not throw `AppError`. It simply returns `undefined` when something isn't found and lets the service layer decide what that means.

---

### 5.4 `services/todo.service.ts`

```typescript
import { todoRepo } from '../repositories/todo.repository';
import { AppError } from '../utils/errors';
import { Todo, CreateTodoDto, UpdateTodoDto } from '../models/todo.model';

export const todoService = {

  list(filter?: { status?: Todo['status']; priority?: Todo['priority'] }): Todo[] {
    return todoRepo.findAll(filter);
  },

  getById(id: string): Todo {
    const todo = todoRepo.findById(id);
    if (!todo) throw new AppError(404, `Todo not found`);
    return todo;
  },

  create(data: CreateTodoDto): Todo {
    // Business rule: todos always start as 'pending' — caller cannot set status on create
    return todoRepo.create({
      title:    data.title,
      priority: data.priority ?? 'medium',
      status:   'pending',
      dueDate:  data.dueDate,
    });
  },

  update(id: string, patch: UpdateTodoDto): Todo {
    const existing = todoRepo.findById(id);
    if (!existing) throw new AppError(404, `Todo not found`);

    // Business rule: completed todos cannot be reverted to pending
    if (existing.status === 'done' && patch.status === 'pending') {
      throw new AppError(400, 'Cannot revert a completed todo back to pending');
    }

    return todoRepo.update(id, patch)!;
  },

  delete(id: string): void {
    const deleted = todoRepo.delete(id);
    if (!deleted) throw new AppError(404, `Todo not found`);
  },
};
```

**Key concept:** Business rules live exclusively in the service layer:
- "Todos always start as pending" — enforced in `create()`
- "Completed todos can't be reverted" — enforced in `update()`  
- The service throws `AppError` — the controller just forwards it to the error handler via `next(err)`

---

### 5.5 `middleware/validate.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';
import { AppError } from '../utils/errors';

// Factory pattern: returns a middleware function for any Zod schema
export const validate = (schema: ZodSchema) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new AppError(400, 'Validation failed', result.error.flatten()));
    }
    req.body = result.data;  // replace raw input with coerced, validated data
    next();
  };
```

**Key concept:** `schema.safeParse()` never throws — it returns `{ success: true, data }` or `{ success: false, error }`. After successful validation, `req.body` is replaced with `result.data` — this gives you Zod's coercions for free (e.g. `default('medium')` is applied, extra fields are stripped).

---

### 5.6 `middleware/errorHandler.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';

// MUST have exactly 4 parameters — Express identifies error handlers by function.length === 4
export const errorHandler = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error:   err.message,
      details: err.details ?? undefined,
    });
  }

  // Unexpected error — log internally, never leak stack traces to the client
  console.error('[Unhandled error]', err);
  res.status(500).json({ error: 'Internal server error' });
};
```

**Key concept — the 4-argument rule:** Express uses `function.length` (the number of declared parameters) to identify error-handling middleware. Declaring only 3 params causes Express to silently skip this middleware during error propagation — one of the most common production bugs in Express apps. Always declare all 4, even if `_next` is unused.

---

### 5.7 `middleware/notFound.ts`

```typescript
import { Request, Response } from 'express';

export const notFound = (_req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
};
```

Mounted after all routes in `app.ts`. Catches any request that didn't match a registered route.

---

### 5.8 `controllers/todo.controller.ts`

```typescript
import { Request, Response, NextFunction } from 'express';
import { todoService } from '../services/todo.service';

export const todoController = {

  list(req: Request, res: Response) {
    const { status, priority } = req.query as Record<string, string>;
    res.json(todoService.list({ status: status as any, priority: priority as any }));
  },

  getById(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(todoService.getById(req.params.id));
    } catch (err) {
      next(err);
    }
  },

  create(req: Request, res: Response) {
    const todo = todoService.create(req.body);
    res.status(201).json(todo);   // 201 Created — not 200
  },

  update(req: Request, res: Response, next: NextFunction) {
    try {
      res.json(todoService.update(req.params.id, req.body));
    } catch (err) {
      next(err);
    }
  },

  remove(req: Request, res: Response, next: NextFunction) {
    try {
      todoService.delete(req.params.id);
      res.status(204).send();     // 204 No Content — no body
    } catch (err) {
      next(err);
    }
  },
};
```

**Key concept:** Controllers are intentionally thin. Their only job: read from `req`, call the service, write to `res`. Any error is forwarded via `next(err)` to the centralised error handler — no error handling logic here.

---

### 5.9 `routes/todo.routes.ts`

```typescript
import { Router } from 'express';
import { todoController } from '../controllers/todo.controller';
import { validate } from '../middleware/validate';
import { createTodoSchema, updateTodoSchema } from '../models/todo.model';

export const todoRouter = Router();

todoRouter.get   ('/',    todoController.list);
todoRouter.post  ('/',    validate(createTodoSchema), todoController.create);
todoRouter.get   ('/:id', todoController.getById);
todoRouter.patch ('/:id', validate(updateTodoSchema), todoController.update);
todoRouter.delete('/:id', todoController.remove);
```

**Key concept:** Route files are declarative. They read like a table of contents. No logic, no imports from service or repo — only controller and middleware.

---

### 5.10 `app.ts`

```typescript
import express from 'express';
import { todoRouter }   from './routes/todo.routes';
import { errorHandler } from './middleware/errorHandler';
import { notFound }     from './middleware/notFound';

const app = express();

app.use(express.json());           // parse JSON bodies — must come before routes
app.use('/todos', todoRouter);     // mount the todo router
app.use(notFound);                 // 404 — after all routes
app.use(errorHandler);             // error handler — must be LAST, 4-arg signature

export { app };
```

**Middleware order matters:**
1. `express.json()` — parses body before routes can read it
2. Routes — matched in registration order
3. `notFound` — only reached if no route matched
4. `errorHandler` — only reached when `next(err)` is called anywhere

---

### 5.11 `server.ts`

```typescript
import { app } from './app';

const PORT = process.env.PORT ?? 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown: stop accepting new connections, finish in-flight requests
process.on('SIGTERM', () => {
  server.close(() => {
    console.log('Server shut down gracefully');
    process.exit(0);
  });
});
```

**Why separate `app.ts` and `server.ts`?** So that tests can import `app` directly and use `supertest` without actually starting an HTTP server on a port. This is standard practice.

---

## 6. Complete Request Lifecycle

### `POST /todos` — happy path

```
1. express.json()          parses { "title": "Buy milk", "priority": "high" }
2. todoRouter              matches POST /
3. validate(createSchema)  safeParse → passes → req.body coerced, priority default applied
4. todoController.create() reads req.body, calls todoService.create()
5. todoService.create()    sets status: 'pending', calls todoRepo.create()
6. todoRepo.create()       generates UUID + timestamps, stores in Map, returns Todo
7. controller              res.status(201).json(todo)
```

### `PATCH /todos/:id` — validation error path

```
1. express.json()          parses {}  (empty body)
2. validate(updateSchema)  safeParse fails — .refine() rejects empty objects
3. validate middleware     next(new AppError(400, 'Validation failed', { ... }))
4. errorHandler            catches AppError, returns 400 JSON — controller never called
```

### `DELETE /todos/:id` — not found path

```
1. todoController.remove() calls todoService.delete('nonexistent-id')
2. todoService.delete()    todoRepo.delete() returns false
3. todoService             throws new AppError(404, 'Todo not found')
4. controller              catch(err) → next(err)
5. errorHandler            catches AppError, returns 404 JSON
```

---

## 7. HTTP Status Codes — Used Correctly

| Code | When to use |
|------|-------------|
| `200 OK` | Successful GET or PATCH |
| `201 Created` | Successful POST — resource was created |
| `204 No Content` | Successful DELETE — no body to return |
| `400 Bad Request` | Validation failed, malformed input |
| `404 Not Found` | Resource with given ID does not exist |
| `422 Unprocessable Entity` | Valid JSON structure but semantically invalid (e.g. future dueDate on a done todo) |
| `500 Internal Server Error` | Unexpected crash — never return details |

---

## 8. Key Design Decisions & Interview Talking Points

### PATCH vs PUT
- `PUT` is idempotent and replaces the **entire** resource — client must send all fields
- `PATCH` is a **partial update** — client sends only the fields that changed
- For a Todo, if you just want to mark it done, PATCH avoids resending title/priority/dueDate
- **Say this proactively** — interviewers always probe on verb choice

### Why Zod over Joi?
- Zod is TypeScript-first — types and validation in one declaration
- `z.infer<typeof schema>` gives you the TypeScript type for free, no duplication
- Better ergonomics with `.safeParse()` (no try/catch needed)
- Joi is runtime-only; requires separate TypeScript interface

### Repository pattern with in-memory Map
- Decouples data access from business logic
- Swapping to Postgres/MongoDB only changes the repository — service and controller unchanged
- Makes unit testing trivial: inject a mock repository, test service in isolation

### The 4-argument error handler (critical)
Express uses `function.length` to identify error middleware. Declaring 3 parameters causes silent failures. This is a production bug that's very hard to diagnose because Express doesn't warn you — it just skips your handler.

### AppError with `Object.setPrototypeOf`
When targeting ES5 in TypeScript, extending built-in classes breaks `instanceof`. `Object.setPrototypeOf(this, AppError.prototype)` restores the prototype chain. Without it, `err instanceof AppError` returns `false` and every error becomes a 500.

### Why `app.ts` and `server.ts` are separate
- `app.ts` exports the Express app without starting a server
- Tests import `app` directly and use `supertest` — no port conflicts, no cleanup needed
- `server.ts` is the sole entry point that binds to a port

---

## 9. Senior-Level Add-ons to Mention

When asked "what would you add for production?":

```
Security
  ├── helmet          — sets 14 security-related HTTP headers
  ├── cors            — configures cross-origin policy
  └── express-rate-limit  — throttle requests per IP

Observability
  ├── x-request-id header  — attach unique ID to every request for tracing
  ├── morgan / pino        — structured request logging
  └── health check at GET /health  — for load balancer heartbeats

Data
  ├── Soft deletes (deletedAt timestamp)  — data recovery, audit trails
  ├── Pagination on GET /todos            — cursor-based for large datasets
  └── DB indexes on status, priority, createdAt for filter queries

Resilience
  ├── Graceful shutdown (already in server.ts)
  ├── Input sanitisation against XSS
  └── Environment config via dotenv / config packages

Testing
  ├── Unit tests: service layer with mock repository (Jest)
  ├── Integration tests: controller + service + in-memory repo
  └── E2E tests: supertest against full Express app
```

---

## 10. Common Interview Follow-up Questions

**Q: Why PATCH instead of PUT?**  
PATCH sends only the changed fields. PUT requires the full resource every time. PATCH is more practical for partial updates and is the correct verb per RFC 5789.

**Q: How would you replace the Map with a real DB?**  
Only `todo.repository.ts` changes. The interface (findAll, findById, create, update, delete) stays the same. Controller and service are completely unaffected — this is the entire point of the Repository pattern.

**Q: How would you add authentication?**  
Add `authMiddleware` before the router: `app.use('/todos', authMiddleware, todoRouter)`. The middleware verifies a JWT from `Authorization: Bearer <token>`, attaches `req.user`, calls `next()` or returns 401. The service layer then filters todos by `userId`.

**Q: How do you test this?**  
Three layers: (1) unit-test the service with a mock repo — tests business rules in isolation; (2) integration-test controller+service with in-memory repo; (3) E2E with supertest against the real app. The layered architecture makes layer (1) trivial.

**Q: What's the difference between 404 and 400?**  
400 = the request itself is malformed (bad input, failed validation). 404 = the request is valid but the resource doesn't exist. Never return 400 for a missing resource.

**Q: Why is the error handler registered last?**  
Express processes middleware in registration order. The error handler must come after all routes so it can catch errors forwarded via `next(err)` from anywhere in the chain. Registering it before routes means it never fires.

---

*Generated as part of GoDaddy Senior Backend Engineer — Round 2 Interview Prep*