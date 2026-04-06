import { Request, Response, NextFunction } from "express";
import { todoService } from "../services/todo.service";

export const todoController = {

    list (req: Request, res: Response, next: NextFunction) {
        const { status, priority } = req.query as Record<string, string>;
        res.json(todoService.list({ status: status as any, priority: priority as any }));
    },

    getById(req: Request, res: Response, next: NextFunction) {
        const todo = todoService.getById(req.params.id as string);
        if (!todo) {
            return next(new Error('Todo not found'));
        }
        res.json(todo);
    },

    create(req: Request, res: Response, next: NextFunction) {
        const todo = todoService.create(req.body);
        res.status(201).json(todo);
    },

    update(req: Request, res: Response, next: NextFunction) {
        const todo = todoService.update(req.params.id as string, req.body);
    },

    remove(req: Request, res: Response, next: NextFunction) {
        todoService.delete(req.params.id as string);
        res.status(204).end();
    }

}