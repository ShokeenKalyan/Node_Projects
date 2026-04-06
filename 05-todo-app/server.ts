import { app } from './app';

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
})

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

/** 

The complete call chain on a `POST /todos` request:

Request arrives
  → express.json() parses body
  → todoRouter matches POST /
  → validate(createTodoSchema) runs — 400 if invalid, attaches parsed body
  → todoController.create() reads req.body, calls service
  → todoService.create() applies business rules, calls repo
  → todoRepo.create() writes to Map, returns Todo
  → controller sends 201 + Todo JSON
  → (if any step throws AppError, errorHandler catches it and formats the response)
  
*/