import { Router } from "express";
import { todoController } from "../controllers/todo.controller";
import { validate } from "../middleware/validate";
import { createTodoSchema, updateTodoSchema } from "../models/todo.model";

export const todoRouter = Router();

todoRouter.get('/', todoController.list);
todoRouter.get('/:id', todoController.getById);
todoRouter.post('/', validate(createTodoSchema), todoController.create);
todoRouter.patch('/:id', validate(updateTodoSchema), todoController.update);
todoRouter.delete('/:id', todoController.remove);
