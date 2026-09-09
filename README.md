# Proxion Workflow API

Proxion is a focused NestJS and PostgreSQL API for an expert-review workflow. It manages projects, expert assignments, versioned submissions, immutable rubric versions, criterion-level reviews, JWT authentication, and an append-only audit trail.

It is intentionally a modular monolith: one deployable NestJS application and one PostgreSQL database. Domain modules create useful boundaries without adding distributed-system complexity to a workflow that does not need it.

## Run locally

Start PostgreSQL and the API with deterministic demo data:

```bash
docker compose up --build
```

The API is available under `http://localhost:3000/api`, Swagger at `http://localhost:3000/api/docs`, and the health endpoint at `GET /api/health`.

For local development, configure a `.env` file with a PostgreSQL connection string and a JWT secret of at least 32 characters:

```bash
DATABASE_URL=postgresql://...
JWT_SECRET=replace-with-a-secret-of-at-least-32-characters
```

Then run:

```bash
yarn install --frozen-lockfile
yarn prisma:migrate
yarn prisma:seed # optional demo data
yarn start:dev
```

Docker Compose sets `SEED_ON_START=true` because it is the work-sample environment. The Docker image defaults it to `false`: migrations run at startup, but production restarts do not seed data. The demo accounts use `Password123!`:

| Role     | Email                      |
| -------- | -------------------------- |
| ADMIN    | `admin@proxion.local`      |
| EXPERT   | `expert@proxion.local`     |
| EXPERT   | `expert-b@proxion.local`   |
| REVIEWER | `reviewer@proxion.local`   |
| REVIEWER | `reviewer-b@proxion.local` |

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

| Layer                                     | Responsibility                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `JwtAuthGuard`                            | Validates the Bearer token, reloads the active user and current role from PostgreSQL, and attaches that user to `request.user`. |
| `RolesGuard`                              | Performs coarse role authorization for `ADMIN`, `EXPERT`, and `REVIEWER`.                                                       |
| `TaskAccessPolicy` / `ReviewAccessPolicy` | Performs resource-level authorization from assignments, submission ownership, and review ownership.                             |

Controllers remain thin: they provide routing, DTO parsing, Swagger metadata, and authenticated-user extraction. Services and policies contain business rules and resource checks.

| Role     | Capabilities                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ADMIN    | Creates projects, tasks, assignments, rubrics, and reviews; reads audit records.                                                      |
| EXPERT   | Reads assigned tasks and only their own submissions; creates or edits only their draft submissions.                                   |
| REVIEWER | Reads submissions only when directly assigned through a Review; records scores, requests rework, and approves only their own reviews. |

## Task workflow

[`TaskWorkflowService`](src/modules/tasks/task-workflow.service.ts) is the only application-level authority allowed to change `Task.status`. Its transition map is centralized and uses optimistic locking.

```text
UNASSIGNED
   |
   v
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
UNASSIGNED -> ASSIGNED (first valid expert assignment)
ASSIGNED -> IN_PROGRESS
IN_PROGRESS -> SUBMITTED
SUBMITTED -> IN_REVIEW
IN_REVIEW -> REWORK
IN_REVIEW -> APPROVED
REWORK -> IN_PROGRESS
APPROVED -> terminal
```

`UNASSIGNED` is a creation-only staging state required by the existing two-step API (`POST /api/projects/:projectId/tasks`, then `POST /api/tasks/:id/assign`). The first valid expert assignment, its assignment audit entry, and the `UNASSIGNED -> ASSIGNED` transition happen in one transaction. The Work Sample workflow starts at `ASSIGNED`; an expert cannot start or create a submission until that expert has a real Assignment.

Each Task has exactly one Assignment and therefore one assigned Expert. This keeps the task-level state machine unambiguous. Repeating assignment for the same Expert is idempotent; assigning another Expert returns `409 TASK_ALREADY_ASSIGNED`.

There is no `REWORK -> APPROVED` transition. After rework, the expert creates and submits a new Submission version; an admin starts a new review cycle; only that review cycle can lead to approval.

Reviewer decisions belong to a concrete `Review`, not to a Task selected indirectly. A review starts as `OPEN` and is completed exactly once with an immutable `decision` (`APPROVED` or `REWORK_REQUESTED`) and `completedAt`. The reviewer uses `POST /api/reviews/:id/approve` or `POST /api/reviews/:id/request-rework`; `TaskWorkflowService` remains the sole authority changing the related Task status.

Approval requires a complete review: every criterion of the pinned `RubricVersion` must have exactly one score inside its allowed range. Otherwise the API returns `409 REVIEW_INCOMPLETE`. Rework deliberately does not require all criteria to be scored, allowing a reviewer to return clearly incomplete work early with focused feedback.

## Transactions and concurrency

Critical operations use explicit Prisma transactions:

- task transition: validate actor, access, and transition; update Task optimistically; insert audit entry;
- submission create/finalization: lock the Task row before lifecycle checks; permit at most one active draft per Assignment; finalize that draft and transition the Task to `SUBMITTED` in the same transaction;
- reviewer decision: lock the Review, validate ownership and completion, transition the Task, complete the Review, and write audit records in the same transaction;
- score mutation: validate the criterion and range; create or update `ReviewScore`; write real `before` and `after` values to AuditLog in the same transaction.

If any step fails, the transaction rolls back. This prevents a submitted Submission with an `IN_PROGRESS` task, or a `SUBMITTED` task with a draft Submission.

The repository deliberately uses two complementary concurrency mechanisms:

- **Optimistic locking** protects normal Task state transitions with `UPDATE ... WHERE id = taskId AND version = expectedVersion`. A stale request receives `409 CONCURRENT_MODIFICATION` without holding a database lock while the request is processed.
- **Row-level locking** (`SELECT ... FOR UPDATE`) is reserved for short critical sections that allocate the next monotonically increasing `Submission.version` or `RubricVersion.version`, submission finalization/draft updates, review scoring/decisions, and idempotent assignment creation.

`Assignment.taskId` is unique, so each Task has one assigned Expert. Repeating the same assignment returns the existing assignment without an extra audit event. Each Assignment has at most one active `DRAFT` Submission, enforced by a PostgreSQL partial unique index; after submission, the next draft can be created only after a rework cycle returns the Task to `IN_PROGRESS`. Submission visibility remains ownership-specific: an expert sees only submissions they authored, and a reviewer sees only submissions directly connected to their own Reviews. Concurrent repeated submit or review-decision requests produce one committed transition; the other request receives a controlled `409` rather than creating duplicate business history.

## Versioning and historical data

```text
Project
 ├── Task ──> Submission v1 (SUBMITTED, immutable)
 │             Submission v2 (DRAFT -> SUBMITTED, immutable)
 └── Rubric -> RubricVersion 1 -> criteria
               RubricVersion 2 -> criteria

Review -> one Submission version + one exact RubricVersion
```

`UNIQUE(assignmentId, version)` guarantees a monotonically increasing submission history for the Task's assigned Expert. An Assignment has at most one active `DRAFT`; that draft may be edited only by its author while the Task is `IN_PROGRESS`. Submission finalizes that draft, and rework permits the next version to be created. Submitted versions are immutable at the application layer: `PATCH /api/submissions/:id` returns `409 SUBMISSION_IMMUTABLE` after finalization, and there is no delete endpoint.

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

`POST /api/auth/login` is protected with Nest's in-memory throttler at ten attempts per minute per client IP. When deployed behind a known reverse proxy, set `TRUST_PROXY=true` so Express derives the client IP from forwarded headers; do not enable it for untrusted direct traffic.

## API and tests

List endpoints use `?page=1&limit=20`, with a maximum `limit` of 100, and return `{ data, meta }`.

- `POST /api/auth/login`
- `GET|POST /api/projects`, `POST /api/projects/:projectId/tasks`
- `GET /api/tasks`, `POST /api/tasks/:id/start|submit`
- `POST|GET /api/tasks/:taskId/submissions`, `PATCH /api/submissions/:id`, `GET /api/submissions/:id`
- `POST /api/projects/:projectId/rubrics`, `POST /api/rubrics/:rubricId/versions`
- `POST /api/submissions/:submissionId/reviews`, `GET|PUT /api/reviews`, `POST /api/reviews/:id/approve|request-rework`
- `GET /api/audit-logs` for admins

Example expert flow after an administrator has created and assigned a task:

```bash
# Obtain the expert token.
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"expert@proxion.local","password":"Password123!"}'

# Set TOKEN to accessToken from the response, then start, draft, and submit the task.
curl -X POST http://localhost:3000/api/tasks/<task-id>/start \
  -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:3000/api/tasks/<task-id>/submissions \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"assignmentId":"<assignment-id>","content":"My completed work"}'
curl -X POST http://localhost:3000/api/tasks/<task-id>/submit \
  -H "Authorization: Bearer $TOKEN"
```

An administrator creates a review using a particular immutable `rubricVersionId`; only the assigned reviewer can then `PUT /api/reviews/<review-id>/scores/<criterion-id>` and make its review-specific decision. Swagger documents all request shapes and role-protected endpoints at `/api/docs`.

The complete workflow is: ADMIN creates a Project, Task, and Assignment; the assigned EXPERT starts the Task, creates and edits one draft, then submits it; ADMIN creates a Review; the assigned REVIEWER records scores and requests rework or approves. After rework, the same EXPERT starts the Task again and creates the next immutable Submission version.

Run backend checks with:

```bash
yarn format
yarn typecheck
yarn lint
yarn format:check
yarn test
yarn build
```

The real HTTP workflow test in [`test/workflow.e2e-spec.ts`](test/workflow.e2e-spec.ts) requires a running seeded API:

```bash
yarn test:e2e
```

It covers login, project/task/rubric setup, assignment, v1 submission, scoring, rework, v2 submission, re-scoring, approval, immutable v1, exact rubric references, audit score history, and final Task status. The test suite also exercises incomplete-review rejection, completed-review score immutability, resource access boundaries, and parallel submission/rubric-version/review/decision requests.

## Scope and scaling limits

The sample deliberately excludes a production frontend/client portal, file storage, bulk import/export, LLM integrations and model gateways, queues, Redis, microservices, Kubernetes, OAuth/SSO, and broad observability infrastructure.

The first practical pressure points at scale are AuditLog growth, large project/task list queries, offset pagination, PostgreSQL connection limits, concurrent writes to hot Tasks, and large Submission payloads. Likely next steps are cursor pagination and projections, audit retention or partitioning, object storage for documents, structured logs and metrics, and background processing for long-running model-evaluation work. A queue becomes appropriate only once those asynchronous workloads exist.
