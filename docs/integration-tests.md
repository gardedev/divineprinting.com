# Integration Tests – DivinePrinting Product API

## Overview

The integration test suite exercises the full request path:

```
HTTP request → Express route → ProductService → ProductRepository → DynamoDB Local
```

No mocks are used inside the integration tests.  Every database call goes to a
real DynamoDB Local instance running in Docker.

---

## Prerequisites

| Tool     | Version | Notes                              |
|----------|---------|------------------------------------|
| Node.js  | ≥ 18    | Matching the project's runtime     |
| npm      | ≥ 9     |                                    |
| Docker   | ≥ 20    | Must be running before tests start |

> **macOS / Windows:** Docker Desktop must be running.  
> **Linux:** The Docker daemon must be active (`sudo systemctl start docker`).

---

## Quick Start

```bash
# Install dependencies
cd divineprinting
npm install

# Run unit tests only (no Docker required)
npm test

# Run integration tests (requires Docker)
npm run test:integration

# Run unit + integration tests together
npm run test:all
```

---

## Isolated Test Table

Integration tests use a **dedicated table** that is NEVER the production table:

```
divine-printing-products-integration-test
```

The table is created automatically by `globalSetup` when the test suite starts
and torn down by `globalTeardown` when it finishes.  Each individual test file
calls `resetIntegrationTable()` in `beforeEach` to guarantee a clean slate.

---

## DynamoDB Local

The tests start a Docker container:

| Setting       | Value                              |
|---------------|------------------------------------|
| Image         | `amazon/dynamodb-local:latest`     |
| Container     | `dynamodb-local-integration-test`  |
| Host port     | `8100`                             |
| Mode          | In-memory (`-inMemory -sharedDb`)  |
| Endpoint      | `http://localhost:8100`            |

Port `8100` was chosen deliberately (not 8000) to avoid collisions with any
other DynamoDB Local instances that may already be running on the host.

### Manual lifecycle

If you need to manage the container manually:

```bash
# Start
docker run -d --name dynamodb-local-integration-test \
  -p 8100:8000 \
  amazon/dynamodb-local:latest \
  -jar DynamoDBLocal.jar -inMemory -sharedDb

# Stop and remove
docker rm -f dynamodb-local-integration-test
```

---

## Table Schema

The integration table mirrors the production schema:

| Attribute   | Type | Role           |
|-------------|------|----------------|
| `productId` | `S`  | Partition key  |
| `slug`      | `S`  | GSI hash key   |

**Global Secondary Index:**

| Index name  | Hash key | Projection |
|-------------|----------|------------|
| `slug-index`| `slug`   | `ALL`      |

The GSI enables the public `GET /api/products/:slug` endpoint to resolve slugs
without a full table scan.

---

## Test File Structure

```
tests/integration/
├── __tests__/
│   ├── adminProducts.integration.test.js     ← Admin CRUD routes
│   ├── authPlaceholder.integration.test.js   ← Auth posture & deny-by-default
│   ├── errorResponses.integration.test.js    ← 4xx / 5xx error shapes
│   ├── productLifecycle.integration.test.js  ← Full CRUD lifecycle flows
│   └── publicProducts.integration.test.js   ← Public list + slug routes
├── fixtures/
│   └── products.js                           ← Unique product payload factory
└── helpers/
    ├── dynamoLocal.js                        ← Docker + table lifecycle
    ├── globalSetup.js                        ← Jest globalSetup
    ├── globalTeardown.js                     ← Jest globalTeardown
    ├── integrationRepository.js             ← Real repository wired to DynamoDB Local
    └── testApp.js                            ← App factory with injectable auth
```

---

## Authentication Testing

### Production behaviour (deny-by-default)

`adminAuth.js` always returns `503 Service Unavailable` with the body:

```json
{ "error": "Admin authentication is not yet configured.", "code": "AUTH_NOT_CONFIGURED" }
```

Tests that verify this behaviour use `createTestApp()` (no override).

### Admin route logic testing

To test the logic inside admin routes (POST, PUT, DELETE, etc.) without being
blocked by the auth guard, the test suite uses `createAuthBypassApp()`.

This injects a **test-only middleware** via the `adminAuthMiddleware` option of
`createApp()`.  The production `adminAuth.js` file is **never modified**.

```js
// testApp.js (test code only — never ships to production)
function testAdminBypass(req, res, next) {
  req.admin = { id: 'test-admin', role: 'admin' };
  next();
}

function createAuthBypassApp() {
  return createApp({
    productService: integrationService,
    adminAuthMiddleware: testAdminBypass, // injected — not in adminAuth.js
  });
}
```

---

## Public Route Scope

| Route                      | Method | Auth required | Notes                          |
|----------------------------|--------|---------------|--------------------------------|
| `GET /api/products`        | GET    | No            | Lists all products             |
| `GET /api/products/:slug`  | GET    | No            | Fetches product by URL slug    |

> There is **no** `GET /api/products/:id` public route.  Public consumers must
> use slugs.  Passing a UUID to `/api/products/:slug` will return `404`.

---

## Running Against CI

The integration test suite is designed for CI environments with Docker:

```yaml
# Example GitHub Actions step
- name: Run integration tests
  run: |
    cd divineprinting
    npm ci
    npm run test:integration
```

The suite manages the Docker container automatically and cleans up on exit.

---

## Troubleshooting

### `ECONNREFUSED` on port 8100

DynamoDB Local container failed to start.  Check:
- Docker is running
- Port 8100 is not already in use (`lsof -i :8100`)
- The `amazon/dynamodb-local` image is available (`docker images | grep dynamodb`)

### Container already exists

A previous test run crashed without cleanup.  Remove it manually:

```bash
docker rm -f dynamodb-local-integration-test
```

The test suite will also attempt this cleanup automatically at startup.

### Tests fail with `ResourceNotFoundException`

The integration table does not exist.  This can happen if `globalSetup` failed.
Run the tests again; the setup hook will recreate the table.

### Slow test startup (> 15s)

Docker image needs to be pulled on first run.  Pull it manually to warm the cache:

```bash
docker pull amazon/dynamodb-local:latest
```

---

## npm Scripts Reference

| Script                    | Description                                    |
|---------------------------|------------------------------------------------|
| `npm test`                | Unit tests only (no Docker)                    |
| `npm run test:unit`       | Alias for `npm test`                           |
| `npm run test:watch`      | Unit tests in watch mode                       |
| `npm run test:coverage`   | Unit tests with coverage report                |
| `npm run test:integration`| Integration tests (requires Docker)            |
| `npm run test:all`        | Unit tests then integration tests              |
