# Proxion workflow API

A deliberately focused NestJS/PostgreSQL backend work sample for the reliable core of an expert-review workflow. It implements projects, task assignment and lifecycle, immutable submission versions, versioned rubrics, criterion-level reviews, JWT authentication, RBAC, and an append-only audit trail. There is intentionally no frontend.

> An optional, fully isolated `dev-client/` exists only for local manual API testing. It can be deleted without changing the backend build, test, deployment, or architecture.

## Running it

The full environment starts with migrations and idempotent seed data:

```bash
docker compose up --build
```

The API listens on `http://localhost:3000`. For local development, copy `.env.example` to `.env`, point `DATABASE_URL` at PostgreSQL, then run:

```bash
npm install
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

Seed credentials (all use `Password123!`) are `admin@proxion.local`, `expert@proxion.local`, and `reviewer@proxion.local`. The seed output includes stable project/task IDs; the seeded task is assigned to the expert and begins in `ASSIGNED`.

Run focused invariant tests with:

```bash
npm test
```

## Code quality

Run every backend quality gate with `npm run check`.

Individual commands are `npm run typecheck`, `npm run lint`, `npm run lint:fix`,
`npm run format`, `npm run format:check`, and `npm test`. These commands cover only the
backend (`src`, `test`, and `prisma`); the optional `dev-client/` is not required.

## Architecture and model

This is a modular monolith. Nest modules keep authentication, projects, tasks/workflow, submissions, rubrics, reviews, audit access, and Prisma infrastructure separate while keeping the workflow transaction local to one PostgreSQL database. That is the smallest architecture which preserves the core invariants without operationally expensive distributed components.

Every primary key is a UUID. A `Project` owns `Task` and `Rubric`; `Assignment` records task-to-expert history rather than placing an expert ID on the task. A `Submission` belongs to a task/expert and has a unique `(taskId, version)`. A `Review` pins both a submission and one precise `RubricVersion`; `ReviewScore` pins every individual criterion score. `AuditLog` has JSONB before/after values and indexes for entity history and actor timelines.

## Workflow

`TaskWorkflowService` is the only location that mutates `Task.status`.

```text
ASSIGNED → IN_PROGRESS → SUBMITTED → IN_REVIEW → APPROVED
                                      └──────→ REWORK → IN_PROGRESS
```

The expert starts and submits assigned work. An admin assigns a reviewer by creating a review, which advances `SUBMITTED → IN_REVIEW`. That assigned reviewer can request rework or approve. `APPROVED` is terminal. Each transition checks resource authorization, validates the transition, conditionally updates the task, and writes the audit record in the same serializable database transaction. An invalid move returns `409 INVALID_STATE_TRANSITION`.

## Versioning, auditability, and concurrency

Submission content is creation-only: there are no update/delete application endpoints. An expert creates a fresh version while a task is `IN_PROGRESS`; submission finalization only sets `submittedAt` for the newest version. Rework returns the task to `IN_PROGRESS`, letting the expert create v2 while v1 remains queryable and unchanged. The `(taskId, version)` unique constraint is the final database backstop. Version allocation takes a PostgreSQL transaction advisory lock keyed by task, so concurrent version requests for the same task serialize while unrelated tasks proceed independently. For a higher-assurance production boundary, I would also revoke direct table mutation from the application role and add a trigger that blocks changes to submission content/version/task/expert fields (and a retention policy for deletes).

Rubric versions are immutable records. New criteria are created only with a new `RubricVersion`; reviews hold `rubricVersionId`, never “latest rubric,” so later edits cannot change historical scoring context. Score updates prove the criterion is from exactly that pinned version and respect its min/max. Each score mutation and its audit record are one serializable transaction.

Task concurrency uses an optimistic `version` column: the transition reads the version then uses `updateMany` with `id + version`. A loser gets `409 CONCURRENT_MODIFICATION`; PostgreSQL serializable retries/errors are mapped to the same safe API response. Audit failures roll back the state/score mutation because they share the transaction.

`AuditLog` is append-only by API design: only internal transactional services create entries, and no update/delete controller exists. At production scale I would give the application role INSERT/SELECT-only rights for this table or place it in a restricted schema.

## Security and API behavior

Authentication is intentionally simple JWT login. Guards provide coarse role checks; services independently enforce assignment/reviewer ownership before reading or mutating task, submission, review, or score resources. This prevents a future controller with an incorrect decorator from becoming an authorization bypass. DTO validation whitelists accepted payload fields. Expected errors are stable `400 VALIDATION_ERROR`, `401 UNAUTHORIZED`, `403 FORBIDDEN`, `404 NOT_FOUND`, and `409` conflict codes; raw Prisma errors are not returned for known races.

Key endpoints:

- `POST /auth/login`
- `POST /projects`, `GET /projects`, `GET /projects/:id`
- `POST /projects/:projectId/tasks`, `GET /tasks/:id`, `POST /tasks/:id/assign`
- `POST /tasks/:id/start`, `/submit`, `/request-rework`, `/approve`
- `POST|GET /tasks/:taskId/submissions`, `GET /submissions/:id`
- `POST /projects/:projectId/rubrics`, `POST /rubrics/:rubricId/versions`, `GET /rubrics/:rubricId/versions/:version`
- `POST /submissions/:submissionId/reviews`, `GET /reviews/:id`, `PUT /reviews/:reviewId/scores/:criterionId`
- `GET /audit-logs` (admin only)

Example happy path (substitute IDs returned by the preceding request):

```bash
TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"expert@proxion.local","password":"Password123!"}' | jq -r .accessToken)
curl -X POST localhost:3000/tasks/22222222-2222-4222-8222-222222222222/start -H "Authorization: Bearer $TOKEN"
curl -X POST localhost:3000/tasks/22222222-2222-4222-8222-222222222222/submissions -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"content":"My evidence-backed answer"}'
curl -X POST localhost:3000/tasks/22222222-2222-4222-8222-222222222222/submit -H "Authorization: Bearer $TOKEN"
```

An admin next creates the review with reviewer and rubric-version UUIDs; the reviewer logs in, reads that review, records scores, and requests rework or approves using the task endpoint.

## Scope, limits, and next work

Deliberately excluded: frontend/client portal, import/export, files, LLM integrations, billing, queues, Redis, Kafka, microservices, Kubernetes, OAuth/SSO, and a full observability or compliance program. Those would obscure the relational and workflow spine this sample is intended to demonstrate.

The first pressure points at volume are an ever-growing audit table, large inline submission payloads, unpaginated project/review reads, connection-pool limits, and write contention on very hot tasks/rubrics. Large documents should move to object storage with a content reference; audit records need retention/partitioning; list endpoints need cursor pagination and purpose-built projections; long-running imports or file processing would finally justify a queue.

The next production steps would be refresh-token/session revocation, UUID parameter pipes and OpenAPI, request-ID middleware/structured logs, pagination, DB-role enforcement for immutable/audit tables, observability, background file processing, and a fuller e2e suite against a disposable PostgreSQL instance.
