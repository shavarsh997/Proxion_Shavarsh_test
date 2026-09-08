# Temporary Proxion testing client

This is a disposable, local-only React/Vite interface for manually exercising the Proxion REST API. It is **not part of the official backend work sample**. The NestJS application does not import, build, deploy, or otherwise depend on this folder; deleting `dev-client/` has no effect on the backend.

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
