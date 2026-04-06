import http, { IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';

// ─── Types ────────────────────────────────────────────────────────────────────

// Extend IncomingMessage so handlers get typed access to query/body
// without casting everywhere. Interface extension is safer than re-declaring
// because it preserves all original Node properties.
interface AppRequest extends IncomingMessage {
    query: Record<string, string | string[]>;
    body:  Record<string, unknown>;
}

// Handler and Middleware are explicit type aliases rather than inline `Function`
// so the contract (req, res, next) is enforced at every call site.
type Handler = (req: AppRequest, res: ServerResponse) => Promise<void> | void;

type Middleware = (
    req:  AppRequest,
    res:  ServerResponse,
    next: () => Promise<void>
) => Promise<void> | void;

// Constrain method strings to the four we actually handle.
// Using a string union prevents silent bugs like routes['GETT'].
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

// ─── Helper ───────────────────────────────────────────────────────────────────

// Centralises writeHead + end so every handler isn't repeating the
// Content-Type header object. Also ensures JSON.stringify is never forgotten.
function sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// ─── Router ───────────────────────────────────────────────────────────────────

class App {
    // One Map per HTTP method: exact path string → handler.
    // Map gives O(1) lookup but only matches literal paths — /users/123 will NOT
    // match a registered '/users/:id' pattern. See 2-dynamic-routes.ts for that.
    private routes: Record<HttpMethod, Map<string, Handler>> = {
        GET:    new Map(),
        POST:   new Map(),
        PUT:    new Map(),
        DELETE: new Map(),
    };

    private middlewares: Middleware[] = [];

    use(middleware: Middleware): void {
        this.middlewares.push(middleware);
    }

    // JS version had four identical one-liners: this.routes['GET'].set(path, handler).
    // Consolidating into a private register() removes the repetition while keeping
    // the public get/post/put/delete API identical.
    get(path: string, handler: Handler): void    { this.register('GET',    path, handler); }
    post(path: string, handler: Handler): void   { this.register('POST',   path, handler); }
    put(path: string, handler: Handler): void    { this.register('PUT',    path, handler); }
    delete(path: string, handler: Handler): void { this.register('DELETE', path, handler); }

    private register(method: HttpMethod, path: string, handler: Handler): void {
        this.routes[method].set(path, handler);
    }

    // ── Middleware chain ──
    // Middleware runs BEFORE the 404 check, so auth/logging always fires —
    // even for routes that don't exist. This matches Express behaviour.
    // (v2 flips this order — middleware is skipped on 404s there.)
    private async runMiddleware(req: AppRequest, res: ServerResponse): Promise<void> {
        let index = 0;
        // Closure captures `index` to track position without a class field.
        const next = async (): Promise<void> => {
            if (index < this.middlewares.length) {
                // Post-increment: grab current index then advance before awaiting,
                // so a middleware that calls next() twice doesn't re-run the same one.
                const middleware = this.middlewares[index++];
                await middleware(req, res, next);
            }
        };
        await next();
    }

    // ── Body parser ──
    // Buffers the request stream into a string, then JSON-parses on 'end'.
    // Returns a Promise so handleRequest can await it before touching req.body.
    // Never rejects: malformed or empty bodies resolve to {} instead of crashing.
    //
    // BUG FIXED: JS version had `chunk.toSring()` (typo) which threw a TypeError
    // on every POST/PUT with a body. Corrected to chunk.toString().
    private parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
        return new Promise((resolve) => {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
                try {
                    resolve(body ? JSON.parse(body) : {});
                } catch {
                    // Malformed JSON — silently fall back so the request can still
                    // reach its handler (handler can validate req.body itself).
                    resolve({});
                }
            });
        });
    }

    async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        // Cast to AppRequest so we can attach query and body below.
        // The cast is safe because we populate both fields before any handler sees req.
        const appReq = req as AppRequest;

        const parsedUrl = parse(req.url ?? '/', true);
        appReq.query = parsedUrl.query as Record<string, string | string[]>;
        appReq.body  = await this.parseBody(req);

        // Middleware runs here — before route lookup — so it always executes.
        await this.runMiddleware(appReq, res);

        const method  = (req.method ?? 'GET') as HttpMethod;
        const path    = parsedUrl.pathname ?? '/';
        const handler = this.routes[method]?.get(path);

        if (!handler) {
            sendJson(res, 404, { error: 'Not Found' });
            return;
        }

        try {
            await handler(appReq, res);
        } catch (err: unknown) {
            // Log server-side for debugging; send a generic message to the client
            // (never leak stack traces or internal details to the response).
            console.error('Handler error:', err);
            sendJson(res, 500, { error: 'Internal Server Error' });
        }
    }

    listen(port: number, callback?: () => void): void {
        const server = http.createServer((req, res) => {
            // createServer callback is synchronous — if we just called handleRequest()
            // without .catch(), a rejection would be an unhandled promise rejection
            // (silent crash in older Node, process exit in newer Node).
            this.handleRequest(req, res).catch((err: unknown) => {
                console.error('Unhandled error in handleRequest:', err);
            });
        });
        server.listen(port, callback);
    }
}

// ─── App setup ────────────────────────────────────────────────────────────────

const app = new App();

app.use(async (req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    await next(); // must call next() or the chain stops here
});

app.get('/users', async (_req, res) => {
    sendJson(res, 200, { users: ['Alice', 'Bob', 'Charlie'] });
});

app.post('/users', async (req, res) => {
    sendJson(res, 201, { message: 'User created', user: req.body });
});

// BUG FIXED: JS version registered 'users/:id' (no leading slash) so these
// handlers were unreachable — the incoming path always starts with '/'.
// Also note: a static Map router cannot match :param patterns anyway.
// These are registered correctly here but will only resolve if the client
// requests the literal string '/users/:id'. See 2-dynamic-routes.ts for real
// parameterized routing.
app.put('/users/:id', async (_req, res) => {
    sendJson(res, 200, { message: 'User updated' });
});

app.delete('/users/:id', async (_req, res) => {
    sendJson(res, 200, { message: 'User deleted' });
});

app.listen(3000, () => console.log('Server running on port 3000'));
