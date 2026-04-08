// =============================================================================
// HTTP ROUTER — Dynamic Routes (TypeScript)
// =============================================================================
//
// CONCEPT:
//   TypeScript rewrite of 2-dynamic-routes.js. Supports :param URL segments via
//   regex-based matching. Routes are compiled once at registration time and stored
//   as CompiledRoute objects in per-method arrays — scanned linearly per request.
//
// KEY TYPES:
//   - AppRequest     : extends IncomingMessage with typed query, body, AND params fields
//   - CompiledRoute  : { routePath, regex, keys, handler } — the compiled form of a route
//   - HttpMethod     : 'GET' | 'POST' | 'PUT' | 'DELETE'
//
// KEY COMPONENTS:
//   - compileRoute() : converts '/users/:id' → { regex: /^\/users\/([^/]+)$/, keys: ['id'] }
//                      called ONCE at registration, not per request
//   - findRoute()    : linear scan — runs regex.exec(path), maps captures → req.params
//   - escapeRegex()  : escapes static segments so dots/parens are matched literally
//   - runMiddleware(): isolated middleware chain, runs AFTER route lookup (see below)
//   - parseBody()    : buffers streamed chunks, JSON-parses on 'end', never rejects
//   - sendJson()     : centralises writeHead + JSON.stringify
//
// IMPROVEMENTS OVER THE JS VERSION:
//   ✓ CompiledRoute interface makes the route object shape explicit and type-safe
//   ✓ AppRequest includes typed `params` field — no casting in handlers
//   ✓ escapeRegex() added — static segments with dots/parens no longer silently wildcard
//   ✓ compileRoute() uses split-map instead of a single .replace() — handles mixed segments
//   ✓ .catch() on handleRequest in listen() — no unhandled promise rejections
//
// ROUTE COMPILATION (key interview insight):
//   Each :param segment is replaced with capture group ([^/]+) at registration.
//   [^/]+ = "one or more non-slash chars" — ensures one segment per param.
//   Static segments are escaped so special regex chars are treated literally.
//
//   Example:
//     Input  : '/posts/:postId/comments/:commentId'
//     Regex  : /^\/posts\/([^/]+)\/comments\/([^/]+)$/
//     keys   : ['postId', 'commentId']
//     Path   : '/posts/42/comments/7'
//     Params : { postId: '42', commentId: '7' }
//
// REQUEST LIFECYCLE:
//   1. Parse URL → attach query to req
//   2. Parse body → attach to req.body
//   3. findRoute → linear scan for regex match → attach params to req
//   4. Respond 404 immediately if no match (middleware is SKIPPED for 404s)
//   5. Run middleware chain (req already has params attached — useful for auth guards)
//   6. Call matched handler — catch errors → respond 500
//
// MIDDLEWARE ORDER DIFFERENCE vs v1:
//   v1: middleware → route lookup → handler  (middleware fires even on 404 paths)
//   v2: route lookup → middleware → handler  (middleware skipped on 404 paths)
//   Trade-off: v2 avoids running expensive middleware on invalid routes,
//   but loses visibility into bad requests (e.g. access logs miss 404s).
//
// STATIC vs DYNAMIC LOOKUP:
//   Static (file 1) : Map.get(path) → O(1), exact match only
//   Dynamic (here)  : linear scan   → O(n routes), supports :params
//   Real routers (e.g. Express) use a Radix/Patricia trie → O(log n) with params.
//
// =============================================================================

import http, { IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AppRequest extends IncomingMessage {
    query:  Record<string, string | string[]>;
    body:   Record<string, unknown>;
    params: Record<string, string>; // populated from :param segments in the URL
}

type Handler = (req: AppRequest, res: ServerResponse) => Promise<void> | void;

type Middleware = (
    req:  AppRequest,
    res:  ServerResponse,
    next: () => Promise<void>
) => Promise<void> | void;

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

// Represents one registered route after its path string has been compiled.
// Stored in an array (not a Map) because matching requires iterating and
// testing each regex — Map's key-lookup wouldn't work for pattern matching.
interface CompiledRoute {
    routePath: string;   // kept for debugging / logging
    regex:     RegExp;   // compiled once at registration, tested per request
    keys:      string[]; // ordered :param names matching the regex capture groups
    handler:   Handler;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

// ─── Router ───────────────────────────────────────────────────────────────────

class App {
    // Arrays instead of Maps: regex matching requires a linear scan.
    // First-registered route wins, so registration order matters.
    private routes: Record<HttpMethod, CompiledRoute[]> = {
        GET:    [],
        POST:   [],
        PUT:    [],
        DELETE: [],
    };

    private middlewares: Middleware[] = [];

    use(middleware: Middleware): void { this.middlewares.push(middleware); }

    get(path: string, handler: Handler): void    { this.addRoute('GET',    path, handler); }
    post(path: string, handler: Handler): void   { this.addRoute('POST',   path, handler); }
    put(path: string, handler: Handler): void    { this.addRoute('PUT',    path, handler); }
    delete(path: string, handler: Handler): void { this.addRoute('DELETE', path, handler); }

    // ── Route compilation ──
    // compileRoute() is called ONCE at registration time, not on every request.
    // This means the regex is built and stored — matching is just .exec(), which is fast.
    private addRoute(method: HttpMethod, routePath: string, handler: Handler): void {
        const { regex, keys } = this.compileRoute(routePath);
        this.routes[method].push({ routePath, regex, keys, handler });
    }

    // Converts a path with :param segments into a regex + ordered param name list.
    //
    // Step-by-step example:
    //
    //   Input:   '/users/:id'
    //   .replace finds '/:id'  → pushes 'id' to keys, replaces with '/([^/]+)'
    //   Pattern: '/users/([^/]+)'
    //   Regex:   /^\/users\/([^/]+)$/
    //   Keys:    ['id']
    //
    //   Input:   '/posts/:postId/comments/:commentId'
    //   .replace runs twice:
    //     '/:postId'    → '/([^/]+)',  keys = ['postId']
    //     '/:commentId' → '/([^/]+)',  keys = ['postId', 'commentId']
    //   Regex:   /^\/posts\/([^/]+)\/comments\/([^/]+)$/
    //
    // [^/]+ means "one or more non-slash characters" — ensures each :param
    // captures exactly one path segment and doesn't bleed across slashes.
    //
    // IMPROVEMENT over JS version: static parts of the path are escaped with
    // escapeRegex() so special regex characters (e.g. dots in '/api.v1/:id')
    // don't silently become wildcards.
    private compileRoute(routePath: string): { regex: RegExp; keys: string[] } {
        const keys: string[] = [];

        // Split on '/:param' boundaries so we can escape static segments separately
        // from the capture groups we're intentionally inserting.
        const pattern = routePath
            .split(/(?=\/:)/)                          // split before each '/:param'
            .map(segment => {
                const paramMatch = segment.match(/^\/:([^/]+)(.*)/);
                if (paramMatch) {
                    // Param segment: replace '/:name' with a capture group,
                    // escape anything that follows (e.g. a trailing file extension)
                    keys.push(paramMatch[1]);
                    return '/([^/]+)' + escapeRegex(paramMatch[2] ?? '');
                }
                // Static segment: escape so dots, parens, etc. are treated literally
                return escapeRegex(segment);
            })
            .join('');

        const regex = new RegExp(`^${pattern}$`);
        return { regex, keys };
    }

    // ── Route matching ──
    // Tests each registered regex against the incoming path.
    // On a match, maps the capture groups back to their named param keys.
    //
    // Example: GET /users/123
    //   Route:  { regex: /^\/users\/([^/]+)$/, keys: ['id'] }
    //   match:  ['/users/123', '123']
    //           match[0] = full match (ignored), match[1..n] = capture groups
    //   Params: { id: '123' }
    //
    // Example: GET /posts/42/comments/7
    //   Route:  { keys: ['postId', 'commentId'] }
    //   match:  ['/posts/42/comments/7', '42', '7']
    //   Params: { postId: '42', commentId: '7' }
    private findRoute(
        method: HttpMethod,
        path: string
    ): { handler: Handler; params: Record<string, string> } | null {
        const routes = this.routes[method] ?? [];
        for (const r of routes) {
            const match = r.regex.exec(path);
            if (!match) continue;

            const params: Record<string, string> = {};
            r.keys.forEach((key, idx) => {
                params[key] = match[idx + 1]; // idx+1 because match[0] is the full string
            });

            return { handler: r.handler, params };
        }
        return null; // no route matched → caller sends 404
    }

    // ── Body parser ── (same as v1, bug fixed)
    private parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
        return new Promise((resolve) => {
            let body = '';
            req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
            req.on('end', () => {
                try   { resolve(body ? JSON.parse(body) : {}); }
                catch { resolve({}); }
            });
        });
    }

    private async runMiddleware(req: AppRequest, res: ServerResponse): Promise<void> {
        let index = 0;
        const next = async (): Promise<void> => {
            if (index < this.middlewares.length) {
                const middleware = this.middlewares[index++];
                await middleware(req, res, next);
            }
        };
        await next();
    }

    async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const appReq    = req as AppRequest;
        const parsedUrl = parse(req.url ?? '/', true);
        const method    = (req.method ?? 'GET') as HttpMethod;
        const path      = parsedUrl.pathname ?? '/';

        appReq.query = parsedUrl.query as Record<string, string | string[]>;
        appReq.body  = await this.parseBody(req);

        // DESIGN DIFFERENCE vs v1: route lookup happens BEFORE middleware.
        //
        // v1 order: middleware → route lookup → handler
        // v2 order: route lookup → middleware → handler
        //
        // Consequence: in v2, middleware (auth, logging, etc.) is SKIPPED entirely
        // for 404 routes. This is a trade-off — you avoid running expensive middleware
        // on invalid routes, but you also lose visibility into bad requests.
        //
        // Which is "correct" depends on the use case:
        //   - If logging all requests matters → run middleware first (v1 order)
        //   - If auth should only apply to real routes → this order is fine
        const match = this.findRoute(method, path);

        if (!match) {
            sendJson(res, 404, { error: 'Not Found' });
            return;
        }

        // Attach params before middleware runs so middleware can also read :params
        // (useful for things like an auth middleware that checks req.params.id).
        appReq.params = match.params;

        await this.runMiddleware(appReq, res);

        try {
            await match.handler(appReq, res);
        } catch (err: unknown) {
            console.error('Handler error:', err);
            sendJson(res, 500, { error: 'Internal Server Error' });
        }
    }

    listen(port: number, callback?: () => void): void {
        const server = http.createServer((req, res) => {
            this.handleRequest(req, res).catch((err: unknown) => {
                console.error('Unhandled error in handleRequest:', err);
            });
        });
        server.listen(port, callback);
    }
}

// ─── Utility ──────────────────────────────────────────────────────────────────

// Escapes characters that have special meaning in RegExp so static route
// segments are matched literally. Without this, a path like '/api.v1/:id'
// would compile to /^\/api.v1\/([^/]+)$/ where '.' matches any character —
// silently accepting '/apixv1/123' as a valid match.
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── App setup ────────────────────────────────────────────────────────────────

const app = new App();

app.use(async (req, _res, next) => {
    console.log(`${req.method} ${req.url}`);
    await next();
});

app.get('/users', async (_req, res) => {
    sendJson(res, 200, { users: ['Alice', 'Bob', 'Charlie'] });
});

app.get('/users/:id', async (req, res) => {
    // req.params.id is typed as string — extracted from the URL by findRoute()
    sendJson(res, 200, { id: req.params.id, message: 'User fetched' });
});

app.post('/users', async (req, res) => {
    sendJson(res, 201, { message: 'User created', user: req.body });
});

app.put('/users/:id', async (req, res) => {
    sendJson(res, 200, { message: 'User updated', id: req.params.id });
});

app.delete('/users/:id', async (req, res) => {
    sendJson(res, 200, { message: 'User deleted', id: req.params.id });
});

app.listen(3000, () => console.log('Server running on port 3000'));
