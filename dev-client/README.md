# Proxion local workflow client

This is a local React/Vite interface for manually exercising the Proxion REST API. It calls the real backend and displays backend validation, authorization, and workflow errors; it does not emulate permissions in the browser.

## Run locally

Start the backend first (for example `docker compose up --build` at repository root), then:

```bash
cd dev-client
yarn install --frozen-lockfile
yarn dev
```

The client sends requests to `/api` (for example, `/api/projects?limit=100`). Vite proxies that path to `http://localhost:3000` during development. To point at another API, copy `.env.example` to `.env` and set `VITE_API_URL` to its API base URL, including `/api`.

Use the seeded login shortcuts. Each uses password `Password123!`:

- `admin@proxion.local`
- `expert@proxion.local`
- `reviewer@proxion.local`

The UI only sends public REST requests and keeps the development JWT in memory. Its Developer panel records the most recent requests and raw backend responses, making 403/409 checks visible.

## Seeded workflows

Running `docker compose up --build` applies the idempotent seed. The following scenarios are ready immediately:

| Scenario                       | Task ID                                | Recommended role  |
| ------------------------------ | -------------------------------------- | ----------------- |
| Draft in progress              | `22222222-2222-4222-8222-222222222222` | expert            |
| Submitted, ready for a review  | `22222222-2222-4222-8222-222222222223` | admin             |
| Open review, ready for scores  | `22222222-2222-4222-8222-222222222224` | reviewer          |
| Rework requested               | `22222222-2222-4222-8222-222222222225` | expert-b          |
| Approved, fully scored example | `22222222-2222-4222-8222-222222222226` | admin or reviewer |

The admin task screen loads and offers only rubric versions belonging to the current task's project.
