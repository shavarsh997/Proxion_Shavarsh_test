# Proxion Workflow API

Proxion is a focused NestJS and PostgreSQL API for an expert-review workflow. It manages projects, expert assignments, versioned submissions, immutable rubric versions, criterion-level reviews, JWT authentication, and an append-only audit trail.

It is intentionally a modular monolith: one deployable NestJS application and one PostgreSQL database. Domain modules create useful boundaries without adding distributed-system complexity to a workflow that does not need it.

## Run locally

Start PostgreSQL and the API with deterministic demo data:

```bash
docker compose up --build
```

The API is available at `http://localhost:3000`, Swagger at `http://localhost:3000/api/docs`, and the health endpoint at `GET /health`.

For local development, configure a `.env` file with a PostgreSQL connection string and a JWT secret of at least 32 characters:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=replace-with-a-secret-of-at-least-32-characters
```

Then run:

```bash
npm install
npx prisma migrate deploy
npx prisma db seed # optional demo data
npm run start:dev
```

Docker Compose sets `SEED_ON_START=true` because it is the work-sample environment. The Docker image defaults it to `false`: migrations run at startup, but production restarts do not seed data. The demo accounts use `Password123!`:

| Role | Email |
| --- | --- |
| ADMIN | `admin@proxion.local` |
| EXPERT | `expert@proxion.local` |
| REVIEWER | `reviewer@proxion.local` |

## Architecture

```text
Client / Swagger
       |
       v
NestJS HTTP API
       |
       +-- Request ID + structured HTTP logging middleware
       +-- JwtAuthGuard: authentication
       +-- RolesGuard: coarse role authorization
       +-- Controller + DTO validation
       |
       v
Application and domain services
       |
       +-- TaskAccessPolicy / ReviewAccessPolicy
       +-- TaskWorkflowService
       |
       v
Prisma transaction for critical mutations
       |
       +-------------------+
       |                   |
       v                   v
Domain data mutations   AuditLog insert
       |                   |
       +---------+---------+
                 v
            PostgreSQL
```

`AuditLog` is a PostgreSQL table, not separate infrastructure. Important domain mutations and their audit records are written in the same transaction, so either both commit or both roll back.

The main entrypoint is [`src/main.ts`](src/main.ts); module composition and environment validation are in [`src/app.module.ts`](src/app.module.ts). The data model is defined in [`prisma/schema.prisma`](prisma/schema.prisma).

### Project layout

```text
src/
├── common/       # guards, decorators, filters, middleware, shared DTOs and interfaces
├── config/       # environment validation and configuration exports
├── database/     # global Prisma module and service
├── modules/      # domain modules
│   ├── auth/
│   ├── audit-logs/
│   ├── health/
│   ├── projects/
│   ├── reviews/
│   ├── rubrics/
│   ├── submissions/
│   ├── tasks/
│   └── users/
├── app.module.ts
└── main.ts
```

Each domain module keeps its controller, service, module declaration, policy when needed, and a local `dto/` folder together. Prisma remains outside domain modules because it is shared infrastructure, not domain logic.

### Authentication and authorization

| Layer | Responsibility |
| --- | --- |
| `JwtAuthGuard` | Validates the Bearer token, reloads the active user and current role from PostgreSQL, and attaches that user to `request.user`. |
| `RolesGuard` | Performs coarse role authorization for `ADMIN`, `EXPERT`, and `REVIEWER`. |
| `TaskAccessPolicy` / `ReviewAccessPolicy` | Performs resource-level authorization from assignments and review ownership. |

Controllers remain thin: they provide routing, DTO parsing, Swagger metadata, and authenticated-user extraction. Services and policies contain business rules and resource checks.

| Role | Capabilities |
| --- | --- |
| ADMIN | Creates projects, tasks, assignments, rubrics, and reviews; reads audit records. |
| EXPERT | Reads assigned tasks and creates or edits their draft submissions. |
| REVIEWER | Reads assigned reviews, records scores, requests rework, and approves reviewed work. |

## Task workflow

[`TaskWorkflowService`](src/modules/tasks/task-workflow.service.ts) is the only application-level authority allowed to change `Task.status`. Its transition map is centralized and uses optimistic locking.

```text
ASSIGNED
   |
   v
IN_PROGRESS
   |
   v
SUBMITTED
   |
   v
IN_REVIEW ----------> APPROVED (terminal)
   |
   v
REWORK
   |
   v
IN_PROGRESS
```

Allowed transitions are:

```text
ASSIGNED -> IN_PROGRESS
IN_PROGRESS -> SUBMITTED
SUBMITTED -> IN_REVIEW
IN_REVIEW -> REWORK
IN_REVIEW -> APPROVED
REWORK -> IN_PROGRESS
APPROVED -> terminal
```

There is no `REWORK -> APPROVED` transition. After rework, the expert creates and submits a new Submission version; an admin starts a new review cycle; only that review cycle can lead to approval.

Reviewer decisions belong to a concrete `Review`, not to a Task selected indirectly. A review starts as `OPEN` and is completed exactly once with an immutable `decision` (`APPROVED` or `REWORK_REQUESTED`) and `completedAt`. The reviewer uses `POST /reviews/:id/approve` or `POST /reviews/:id/request-rework`; `TaskWorkflowService` remains the sole authority changing the related Task status.

Approval requires a complete review: every criterion of the pinned `RubricVersion` must have exactly one score inside its allowed range. Otherwise the API returns `409 REVIEW_INCOMPLETE`. Rework deliberately does not require all criteria to be scored, allowing a reviewer to return clearly incomplete work early with focused feedback.

## Transactions and concurrency

Critical operations use explicit Prisma transactions:

- task transition: validate actor, access, and transition; update Task optimistically; insert audit entry;
- submission finalization: lock the Task row; finalize the latest draft; transition the Task to `SUBMITTED` in the same transaction;
- reviewer decision: lock the Review, validate ownership and completion, transition the Task, complete the Review, and write audit records in the same transaction;
- score mutation: validate the criterion and range; create or update `ReviewScore`; write real `before` and `after` values to AuditLog in the same transaction.

If any step fails, the transaction rolls back. This prevents a submitted Submission with an `IN_PROGRESS` task, or a `SUBMITTED` task with a draft Submission.

The repository deliberately uses two complementary concurrency mechanisms:

- **Optimistic locking** protects normal Task state transitions with `UPDATE ... WHERE id = taskId AND version = expectedVersion`. A stale request receives `409 CONCURRENT_MODIFICATION` without holding a database lock while the request is processed.
- **Row-level locking** (`SELECT ... FOR UPDATE`) is reserved for short critical sections that allocate the next monotonically increasing `Submission.version` or `RubricVersion.version`, submission finalization/draft updates, review scoring/decisions, and idempotent assignment creation.

`Assignment` is unique by `(taskId, expertId)`. Repeating the same assignment returns the existing assignment without an extra audit event. Concurrent repeated submit or review-decision requests produce one committed transition; the other request receives a controlled `409` rather than creating duplicate business history.

## Versioning and historical data

```text
Project
 ├── Task ──> Submission v1 (SUBMITTED, immutable)
 │             Submission v2 (DRAFT -> SUBMITTED, immutable)
 └── Rubric -> RubricVersion 1 -> criteria
               RubricVersion 2 -> criteria

Review -> one Submission version + one exact RubricVersion
```

`UNIQUE(taskId, version)` guarantees a unique submission history per task. A draft may be edited only by its author while the task is `IN_PROGRESS`. Submitted versions are immutable at the application layer: `PATCH /submissions/:id` returns `409 SUBMISSION_IMMUTABLE` after finalization, and there is no delete endpoint.

`UNIQUE(rubricId, version)` guarantees rubric version identity. Each Review permanently references `rubricVersionId`, and each ReviewScore references its exact criterion. Later rubric versions cannot alter historical scoring context. There is no generic update or delete API for historical rubric versions or criteria.

## Auditability and errors

`AuditLog` is append-only at the application layer. The application only inserts and reads audit records; it exposes no `PATCH` or `DELETE` audit endpoint. Project/task creation, assignment, submission lifecycle, rubric/version creation, review creation, score changes, and review decisions are written in the same transaction as their domain change. Entries deliberately record metadata rather than submission text, passwords, tokens, or secrets. Production hardening could enforce immutable submissions and append-only auditing with restricted database permissions or PostgreSQL triggers.

Application diagnostics are separate from AuditLog. A request-completion middleware emits a safe structured record with request ID, method, path, authenticated user ID, status and duration; the exception filter emits a corresponding structured error/warning record without request bodies, authorization headers or infrastructure details.

[`ApiExceptionFilter`](src/common/filters/api-exception.filter.ts) normalizes domain exceptions, Nest HTTP exceptions, validation failures, Prisma known errors, and unexpected errors. It does not expose SQL, Prisma internals, stack traces, database credentials, or raw infrastructure errors.

```json
{
  "statusCode": 409,
  "code": "INVALID_STATE_TRANSITION",
  "message": "Transition ASSIGNED -> APPROVED is not allowed",
  "requestId": "a4c28baf-1b96-4c57-b315-1b8e5fbbf097"
}
```

Every request accepts `X-Request-ID`; a client value is retained only when it is 1–128 safe alphanumeric/`._-` characters, otherwise the API generates a UUID. The ID is returned in the response header and error payload, passed to application logs, and stored in business audit records.

## Authentication hardening

`User.isActive` is checked at login and on every authenticated request. Deactivating a user invalidates an already-issued access token immediately; reloading the user also makes a role change effective immediately instead of waiting for the token's eight-hour expiry. This project does not implement refresh tokens or token-version revocation, so a still-active user's stolen token remains usable until expiry.

`POST /auth/login` is protected with Nest's in-memory throttler at ten attempts per minute per client IP. When deployed behind a known reverse proxy, set `TRUST_PROXY=true` so Express derives the client IP from forwarded headers; do not enable it for untrusted direct traffic.

## API and tests

List endpoints use `?page=1&limit=20`, with a maximum `limit` of 100, and return `{ data, meta }`.

- `POST /auth/login`
- `GET|POST /projects`, `POST /projects/:projectId/tasks`
- `GET /tasks`, `POST /tasks/:id/start|submit`
- `POST|GET /tasks/:taskId/submissions`, `PATCH /submissions/:id`, `GET /submissions/:id`
- `POST /projects/:projectId/rubrics`, `POST /rubrics/:rubricId/versions`
- `POST /submissions/:submissionId/reviews`, `GET|PUT /reviews`, `POST /reviews/:id/approve|request-rework`
- `GET /audit-logs` for admins

Example expert flow after an administrator has created and assigned a task:

```bash
# Obtain the expert token.
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"expert@proxion.local","password":"Password123!"}'

# Set TOKEN to accessToken from the response, then start, draft, and submit the task.
curl -X POST http://localhost:3000/tasks/<task-id>/start \
  -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3000/tasks/<task-id>/submissions \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"content":"My completed work"}'
curl -X POST http://localhost:3000/tasks/<task-id>/submit \
  -H "Authorization: Bearer $TOKEN"
```

An administrator creates a review using a particular immutable `rubricVersionId`; only the assigned reviewer can then `PUT /reviews/<review-id>/scores/<criterion-id>` and make its review-specific decision. Swagger documents all request shapes and role-protected endpoints at `/api/docs`.

Run backend checks with:

```bash
npm run format
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

The real HTTP workflow test in [`test/workflow.e2e-spec.ts`](test/workflow.e2e-spec.ts) requires a running seeded API:

```bash
npm run test:e2e
```

It covers login, project/task/rubric setup, assignment, v1 submission, scoring, rework, v2 submission, re-scoring, approval, immutable v1, exact rubric references, audit score history, and final Task status. The test suite also exercises incomplete-review rejection, completed-review score immutability, resource access boundaries, and parallel submission/rubric-version/review/decision requests.

`dev-client/` is an optional API exerciser. The root TypeScript, ESLint, Jest, Docker, build, and runtime configurations do not depend on it, so it can be removed without affecting the backend.

## Scope and scaling limits

The sample deliberately excludes a production frontend/client portal, file storage, bulk import/export, LLM integrations and model gateways, queues, Redis, microservices, Kubernetes, OAuth/SSO, and broad observability infrastructure. `dev-client/` remains an isolated development-only API exerciser, not a deployed product client.

The first practical pressure points at scale are AuditLog growth, large project/task list queries, offset pagination, PostgreSQL connection limits, concurrent writes to hot Tasks, and large Submission payloads. Likely next steps are cursor pagination and projections, audit retention or partitioning, object storage for documents, structured logs and metrics, and background processing for long-running model-evaluation work. A queue becomes appropriate only once those asynchronous workloads exist.
