import { todoRepository } from "../repositories/todo.repository";
import { Todo } from "../models/todo.model";
import { AppError } from '../utils/errors';


export const todoService = {

    list(filter?: { status?: Todo['status']; priority?: Todo['priority'] }): Todo[] {
        return todoRepository.findAll(filter);
    },

    getById(id: string): Todo {
        const todo = todoRepository.findById(id);
        if (!todo) {
            throw new AppError(404, `Todo ${id} not found`);
        }
        return todo;
    },

    create(data: {  title: string; description?: string; priority: Todo['priority'], dueDate?: string }): Todo {
        return todoRepository.create({
            title: data.title,
            priority: data.priority,
            status: 'pending', // New todos are always created with 'pending' status
            dueDate: data.dueDate
        })
    },

    update(id: string, patchData: Partial<Pick<Todo, 'title' | 'priority' | 'status' | 'dueDate'>>): Todo {
        // Business rule: can't un-complete a todo (pending → done only)
        const existing = todoRepository.findById(id);
        if (!existing) {
            throw new AppError(404, `Todo ${id} not found`);
        }

        if (existing.status === 'done' && patchData.status === 'pending') {
            throw new AppError(400, 'Cannot revert a completed todo back to pending');
        }

        return todoRepository.update(id, patchData) as Todo;
    },

    delete(id: string): void {
        const existed = todoRepository.delete(id);
        if (!existed) {
            throw new AppError(404, `Todo ${id} not found`);
        }
    }

}