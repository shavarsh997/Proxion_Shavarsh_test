# Proxion local workflow client

This is a local React/Vite interface for manually exercising the Proxion REST API. It calls the real backend and displays backend validation, authorization, and workflow errors; it does not emulate permissions in the browser.

## Run locally

Start the backend first (for example `docker compose up --build` at repository root), then:

```bash
cd dev-client
npm install
npm run dev
```

The default API address is `http://localhost:3000`. To point at another local API, copy `.env.example` to `.env` and set `VITE_API_URL`.

Use the seeded login shortcuts. Each uses password `Password123!`:

- `admin@proxion.local`
- `expert@proxion.local`
- `reviewer@proxion.local`

The UI only sends public REST requests and stores the development JWT in browser local storage. Its Developer panel records the most recent requests and raw backend responses, making 403/409 checks visible.

## Seeded workflows

Running `docker compose up --build` applies the idempotent seed. The following scenarios are ready immediately:

| Scenario | Task ID | Recommended role |
| --- | --- | --- |
| Draft in progress | `22222222-2222-4222-8222-222222222222` | expert |
| Submitted, ready for a review | `22222222-2222-4222-8222-222222222223` | admin |
| Open review, ready for scores | `22222222-2222-4222-8222-222222222224` | reviewer |
| Rework requested | `22222222-2222-4222-8222-222222222225` | expert-b |
| Approved, fully scored example | `22222222-2222-4222-8222-222222222226` | admin or reviewer |

The default Quality rubric version used in the admin task screen is `55555555-5555-4555-8555-555555555551`.
