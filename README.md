# @framedash/api-client

Shared REST API client for the Framedash Developer Platform. Used by `@framedash/cli` and `@framedash/mcp-server`.

## Exports

- **`ApiClient`** — HTTP client with project-scoped request helpers, automatic error handling, and 30s timeout
- **`ApiError`** — Typed error with `status` and `headers` for structured error handling

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

## Build

```bash
pnpm --filter @framedash/api-client build
```
