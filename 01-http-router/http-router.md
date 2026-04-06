# HTTP Router (from scratch)

Building an Express-like HTTP router using only Node's built-in `http` and `url` modules.
Two progressively enhanced versions: static route matching → dynamic (parameterized) route matching.

---

## Project Structure

| File | What it covers |
|---|---|
| [1-static-routes.js](1-static-routes.js) | Router with `Map`-based exact-path matching + middleware |
| [2-dynamic-routes.js](2-dynamic-routes.js) | Router with regex-compiled routes + `:param` extraction |

---

## Request Lifecycle (both versions)

```
Incoming request
      │
      ▼
  url.parse()          → extract pathname, query string
      │
      ▼
  parseBody()          → buffer stream chunks → JSON.parse
      │
      ▼
  Middleware chain      → execute in order via next()
      │
      ▼
  Route lookup          → Map.get(path)  [v1]  /  regex match  [v2]
      │
      ├─ No match  →  404 { error: 'Not Found' }
      │
      └─ Match     →  handler(req, res)
                           │
                      catch(err) → 500 { error: 'Internal Server Error' }
```

---

## Version 1 — Static Routes ([1-static-routes.js](1-static-routes.js))

### Data structure

Routes are stored as a plain object of `Map`s keyed by HTTP method:

```js
this.routes = {
    'GET':    new Map(),   // path → handler
    'POST':   new Map(),
    'PUT':    new Map(),
    'DELETE': new Map()
}
```

Route registration is a direct `Map.set(path, handler)`:

```js
get(path, handler)    { this.routes['GET'].set(path, handler); }
post(path, handler)   { this.routes['POST'].set(path, handler); }
put(path, handler)    { this.routes['PUT'].set(path, handler); }
delete(path, handler) { this.routes['DELETE'].set(path, handler); }
```

### Route lookup

```js
const handler = this.routes[method]?.get(path);
// Exact string match only — /users/123 will NOT match /users/:id
```

`?.` optional chaining guards against unknown HTTP methods.

### Middleware chain

```js
let index = 0;
const next = async () => {
    if (index < this.middlewares.length) {
        const middleware = this.middlewares[index++];
        await middleware(req, res, next);  // middleware must call next() to continue
    }
};
await next();
```

- Middlewares are pushed into `this.middlewares[]` via `app.use(fn)`.
- Each middleware receives `(req, res, next)` — calling `next()` advances to the next one.
- Async middlewares are `await`-ed; unhandled errors bubble up.

### Body parsing

```js
parseBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(body ? JSON.parse(body) : {}); }
            catch { resolve({}); }   // malformed JSON → empty object, never rejects
        });
    });
}
```

- Collects stream chunks into a string, then JSON-parses on `end`.
- Falls back to `{}` on parse failure — prevents crashes on malformed bodies.
- Result is attached to `req.body`.

### Known bug in v1

```js
// 1-static-routes.js line 88
body += chunk.toSring();   // ← typo: toSring() instead of toString()
```

This causes a `TypeError` on any POST/PUT request with a body. Fixed in v2.

### Usage example

```js
const app = new App();

app.use(async (req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    await next();
});

app.get('/users', async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ users: ['Alice', 'Bob', 'Charlie'] }));
});

app.listen(3000, () => console.log('Server running on port 3000'));
```

---

## Version 2 — Dynamic Routes ([2-dynamic-routes.js](2-dynamic-routes.js))

### Data structure change

Routes are now stored as **arrays** (not Maps) because multiple routes can share a method, and each needs its compiled regex:

```js
this.routes = {
    'GET':    [],   // [{ routePath, regex, keys, handler }, ...]
    'POST':   [],
    'PUT':    [],
    'DELETE': []
}
```

### Route compilation — `compileRoute(routePath)`

Converts a path string with `:param` segments into a regex and a list of parameter names:

```js
compileRoute(routePath) {
    const keys = [];
    const pattern = routePath.replace(/\/:([^/]+)/g, (_, key) => {
        keys.push(key);       // capture param name
        return '/([^/]+)';    // replace with capture group
    });
    const regex = new RegExp(`^${pattern}$`);
    return { regex, keys };
}
```

**Walkthrough:**

```
Input:   '/users/:id'
Replace: '/:id'  →  '/([^/]+)',  keys = ['id']
Pattern: '/users/([^/]+)'
Regex:   /^\/users\/([^\/]+)$/

Input:   '/posts/:postId/comments/:commentId'
keys:    ['postId', 'commentId']
Regex:   /^\/posts\/([^\/]+)\/comments\/([^\/]+)$/
```

Registered route shape:
```js
{ routePath: '/users/:id', regex: /^\/users\/([^/]+)$/, keys: ['id'], handler: fn }
```

### Route matching — `findRoute(method, path)`

```js
findRoute(method, path) {
    const routes = this.routes[method] || [];
    for (const r of routes) {
        const match = r.regex.exec(path);
        if (!match) continue;
        const params = {};
        r.keys.forEach((key, idx) => { params[key] = match[idx + 1]; });
        //                                                      ^^^^
        //                  match[0] = full string, match[1..n] = capture groups
        return { handler: r.handler, params };
    }
    return null;
}
```

**Example:**

```
Request:  GET /users/123
Route:    { regex: /^\/users\/([^/]+)$/, keys: ['id'] }
match:    ['/users/123', '123']
params:   { id: '123' }
Return:   { handler: fn, params: { id: '123' } }
```

Result is attached as `req.params` before handler execution.

### Nested params example

```
GET /posts/42/comments/7
Route: '/posts/:postId/comments/:commentId'
keys:  ['postId', 'commentId']
match: ['/posts/42/comments/7', '42', '7']
params: { postId: '42', commentId: '7' }
```

### Usage example

```js
app.get('/users/:id', async (req, res) => {
    const id = req.params.id;   // extracted from URL
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id, message: 'User fetched' }));
});

app.put('/users/:id', async (req, res) => { ... });
app.delete('/users/:id', async (req, res) => { ... });
```

---

## Key Differences: v1 vs v2

| Aspect | v1 Static | v2 Dynamic |
|---|---|---|
| Route storage | `Map<string, handler>` | `Array<{ regex, keys, handler }>` |
| Matching | `Map.get(path)` — O(1) exact match | Loop + `regex.exec(path)` — O(n) |
| Params | None — no `:param` support | `req.params` populated from regex groups |
| Route registration | `set(path, handler)` | `compileRoute()` → push to array |
| `parseBody` bug | `chunk.toSring()` — typo crashes | `chunk.toString()` — fixed |

---

## `req` object enrichment

By the time a handler runs, `req` has been enriched with:

| Property | Source | Example |
|---|---|---|
| `req.query` | `url.parse(req.url, true).query` | `{ page: '2', limit: '10' }` |
| `req.body` | `parseBody()` stream buffering | `{ name: 'Alice' }` |
| `req.params` | `findRoute()` regex capture groups (v2 only) | `{ id: '123' }` |

---

## Error handling

| Scenario | Response |
|---|---|
| No matching route | `404 { error: 'Not Found' }` |
| Handler throws | `500 { error: 'Internal Server Error' }` |
| Malformed JSON body | `req.body = {}` — silent fallback, no crash |
| Unknown HTTP method | `this.routes[method]` → `undefined`, `?.get()` returns `undefined` → 404 |
