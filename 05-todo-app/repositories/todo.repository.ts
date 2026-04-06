import { Todo } from "../models/todo.model";
import { randomUUID } from "crypto";

// In-memory store for todos
const store = new Map<string, Todo>();

export const todoRepository = {

    // findAll with optional filtering by status and priority
    findAll: (filter?: any): Todo[] => {
        let todos = [...store.values()];
        if (filter?.status) {
            todos = todos.filter(todo => todo.status === filter.status);
        }
        if (filter?.priority) {
            todos = todos.filter(todo => todo.priority === filter.priority);
        }
        return todos.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    },

    // findById returns null if not found
    findById: (id: string): Todo | null => {
        return store.get(id) || null;
    },

    // create a new todo
    create: (data: Omit<Todo, 'id' | 'createdAt' | 'updatedAt'>): Todo => {
        const now = new Date().toISOString();
        const todo: Todo = { ...data, id: randomUUID(), createdAt: now, updatedAt: now };
        store.set(todo.id, todo);
        return todo;
    },

    // Update an existing todo by id, returns null if not found
    update: (id: string, patchData: Partial<Todo>): Todo | null => {
        const existing = store.get(id);
        if (!existing) {
            return null;
        }

        const updated: Todo = { ...existing, ...patchData, updatedAt: new Date().toISOString() };
        store.set(id, updated);
        return updated;
    },

    // Delete a todo by id, returns true if deleted, false if not found
    delete: (id: string): boolean => {
        store.delete(id);
        return true;
    }

}