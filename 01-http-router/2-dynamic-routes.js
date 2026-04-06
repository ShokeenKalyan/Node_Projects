const http = require('http');
const url = require('url');

class App {
    constructor() {
        this.routes = {
            'GET': [],
            'POST': [],
            'PUT': [],
            'DELETE': []
        }
        this.middlewares = [];
    }

    // Register middleware
    use(middleware) {
        this.middlewares.push(middleware);
    }

    // Register routes - GET
    get(path, handler) {
        this.addRoute('GET', path, handler);
    }

    // Register routes - POST
    post(path, handler) {
        this.addRoute('POST', path, handler);
    }

    // Register routes - PUT
    put(path, handler) {
        this.addRoute('PUT', path, handler);
    }

    // Register routes - DELETE
    delete(path, handler) {
        this.addRoute('DELETE', path, handler);
    }

    // Add route with dynamic parameters
    addRoute(method, routePath, handler) {
        const { regex, keys } = this.compileRoute(routePath);
        this.routes[method].push({ routePath, regex, keys, handler });
    }
    /** 
     * Example routes 
     * [ 
     *  { routePath: '/users/:id', regex: /^\/users\/([^/]+)$/, keys: ['id'], handler: [Function: handler] },
     *  { routePath: '/posts/:postId/comments/:commentId', regex: /^\/posts\/([^/]+)\/comments\/([^/]+)$/, keys: ['postId', 'commentId'], handler: [Function: handler] } 
     * ]
    */

    // Compile route path to regex and extract parameter keys
    compileRoute(routePath) {
        const keys = [];
        // Convert route path with parameters (e.g., /users/:id) to regex and extract keys
        const pattern = routePath.replace(/\/:([^/]+)/g, (_, key) => {
            keys.push(key);
            return '/([^/]+)';
        });
        const regex = new RegExp(`^${pattern}$`);
        return { regex, keys };

        // Example: /users/:id -> /^\/users\/([^/]+)$/ with keys = ['id']
    }

    async handleRequest(req, res) {
        const parsedUrl = url.parse(req.url, true);
        const path = parsedUrl.pathname;
        const method = req.method;
        
        // Put query parameters in req
        req.query = parsedUrl.query;

        // Put body in req for POST and PUT requests
        req.body = await this.parseBody(req);

        // Find matching route
        // Example: For GET /users/123, it will match the route /users/:id and extract id=123
        const match = this.findRoute(method, path);
        console.log('Matched route:', match); // Example: { handler: [Function: handler], params: { id: '123' } }

        // If no match found, return 404
        if (!match) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Not Found' }));
            return;
        }

        // Put route parameters in req
        req.params = match.params;

        // Execute middleware chain
        let index = 0;
        const next = async () => {
            if (index < this.middlewares.length) {
                const middleware = this.middlewares[index++];
                await middleware(req, res, next);
            }
        }
        await next();

        // Execute handlers with error handling
        try {
            await match.handler(req, res);
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

    // Find matching route and extract parameters
    // Example: For GET /users/123, it will match the route /users/:id and extract id=123
    findRoute(method, path) {
        const routes = this.routes[method] || [];
        // Loop through registered routes for the method and find a match
        for (const r of routes) {
            const match = r.regex.exec(path);
            if (!match) continue;
            const params = {};
            // Extract parameters from the matched route
            r.keys.forEach((key, idx) => { params[key] = match[idx + 1]; });
            return { handler: r.handler, params };
            // Example return value: { handler: [Function: handler], params: { id: '123' } }
        }
        return null;
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

app.get('/users/:id', async (req, res) => {
    console.log('Route parameters:', req.params); // Example: { id: '123' }
    const id = req.params.id;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, message: 'User fetched' }));
});

app.post('/users', async (req, res) => {
    const user = req.body;
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'User created', user }));
})

app.put('/users/:id', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'User updated' }));
})

app.delete('/users/:id', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'User deleted' }));
})

// Start the server
app.listen(3000, () => {
    console.log('Server is running on port 3000');
})





