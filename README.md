# @framedash/api-client

Shared REST API client for the Framedash Developer Platform. Used by `@framedash/cli` and `@framedash/mcp-server`.

## Exports

- **`ApiClient`** — HTTP client with project-scoped request helpers, automatic error handling, and 30s timeout
- **`ApiError`** — Typed error with `status` and `headers` for structured error handling
- **`readPerformanceRun` / `comparePerformanceRuns`** — LP2 pilot helpers added in 0.1.6 for bounded per-frame evidence, completeness and declared-condition checks. Version 0.1.5 and earlier do not include them. A comparable result is not a regression verdict.

## Usage

```typescript
import { ApiClient, ApiError } from "@framedash/api-client";

const client = new ApiClient({
  baseUrl: "https://app.framedash.dev",
  apiKey: "fd_...",
  projectId: "uuid",
  onError: (err: ApiError) => {
    throw err;
  },
});

// Project-scoped request
const data = await client.get(client.projectPath("analytics/dashboard"));

// Switch project context
const other = client.withProject("other-uuid");
```

### Query timeout

All requests default to 30 seconds. Set `queryTimeoutMs: 120_000` in the client
options to allow a query to wait for ClickHouse to resume from idle. The option
applies only to `POST /api/v1/query`, including query strings and deployments
under a base URL path. Other requests retain the 30-second timeout.

`queryTimeoutMs` is an integer number of milliseconds from 1 to 2,147,483,647.
`withProject()` preserves the setting. The CLI and MCP server explicitly use
120,000 milliseconds; the client does not retry HTTP requests.

## Build

```bash
pnpm --filter @framedash/api-client build
```
