import express from 'express';
import { todoRouter }   from './routes/todo.routes';
import { errorHandler } from './middleware/errorHandler';
import { notFound }     from './middleware/notFound';

// app.ts - main application setup
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());                         // parse JSON bodies

// Mount the todo routes at /todos
app.use('/todos', todoRouter);

// 404 handler for unmatched routes
app.use(notFound);                               // 404 for unmatched routes

// Global error handler - must be last middleware
app.use(errorHandler);                           // must be last, 4-arg signature

// Export the app for use in server.ts and testing
export { app };