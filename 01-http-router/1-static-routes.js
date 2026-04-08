
// =============================================================================
// HTTP ROUTER — Static Routes
// =============================================================================
//
// CONCEPT:
//   Build a minimal Express-like HTTP router on top of Node's native `http`
//   module — no frameworks. Routes are stored in per-method Maps keyed by the
//   exact path string (static matching only; no params, no wildcards).
//
// KEY COMPONENTS:
//   - routes      : { GET, POST, PUT, DELETE } — each a Map<path, handler>
//   - middlewares : ordered array of async functions run before route handler
//   - handleRequest: parses URL + body, runs middleware chain, dispatches route
//   - parseBody   : collects streamed chunks and JSON-parses the body
//
// REQUEST LIFECYCLE:
//   1. Parse URL → extract pathname and query string
//   2. Parse body (for POST/PUT) → attach to req.body
//   3. Run middleware chain (req, res, next) in order
//   4. Look up handler in routes[method].get(path)
//   5. Call handler — or respond 404 if not found
//   6. Catch any handler error and respond 500
//
// WHY STATIC ROUTES (vs dynamic)?
//   ✓ O(1) lookup via Map — fastest possible dispatch
//   ✗ Cannot match /users/:id — see 2-dynamic-routes.js for pattern matching
//
// MIDDLEWARE CHAIN (key interview insight):
//   Uses a recursive `next()` function rather than iterating with a for-loop.
//   Each middleware must call `await next()` to pass control forward.
//   If a middleware does NOT call next(), the chain stops there (useful for auth guards).
// =============================================================================

const http = require('http');
const url = require('url');

class App {
    constructor() {
        this.routes = {
            'GET': new Map(),
            'POST': new Map(),
            'PUT': new Map(),
            'DELETE': new Map()
        }
        this.middlewares = [];
    }

    // Register middleware
    use(middleware) {
        this.middlewares.push(middleware);
    }

    // Register routes - GET
    get(path, handler) {
        this.routes['GET'].set(path, handler);
    }

    // Register routes - POST
    post(path, handler) {
        this.routes['POST'].set(path, handler);
    }

    // Register routes - PUT
    put(path, handler) {
        this.routes['PUT'].set(path, handler);
    }

    // Register routes - DELETE
    delete(path, handler) {
        this.routes['DELETE'].set(path, handler);
    }

    async handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const path = parsedUrl.pathname;
        const method = req.method;
        
        // Put query parameters in req
        req.query = parsedUrl.query;

        // Put body in req for POST and PUT requests
        req.body = await this.parseBody(req);

        // Execute middleware chain
        let index = 0;
        const next = async () => {
            if (index < this.middlewares.length) {
                const middleware = this.middlewares[index++];
                await middleware(req, res, next);
            }
        }
        await next();

        // Route handling
        const handler = this.routes[method]?.get(path);

        // If no handler found, return 404
        if (!handler) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not Found' }));
            return;
        }

        // Execute handlers with error handling
        try {
            await handler(req, res);
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal Server Error' }));
        }


    }

    // Parse request body for POST and PUT requests
    parseBody(req) {
        return new Promise((resolve, reject) => {
            let body = '';

            req.on('data', chunk => {
                body += chunk.toString();
            })

            req.on('end', () => {
                try {
                    const parsedBody = body ? JSON.parse(body): {};
                    resolve(parsedBody);
                } catch (err) {
                    resolve({});
                }
            })
        })
    }

    // Start the server
    listen(port, callback) {
        const server = http.createServer((req, res) => {
            this.handleRequest(req, res);
        })
        server.listen(port, callback);
    }

}

const app = new App();

// Example middleware to log requests
app.use(async (req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    await next();
})

// Routes
app.get('/users', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ users: ['Alice', 'Bob', 'Charlie'] }));
})

app.post('/users', async (req, res) => {
    const user = req.body;
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'User created', user }));
})

app.put('users/:id', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'User updated' }));
})

app.delete('users/:id', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'User deleted' }));
})

// Start the server
app.listen(3000, () => {
    console.log('Server is running on port 3000');
})





