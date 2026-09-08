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
       +-- Request ID middleware
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
| `JwtAuthGuard` | Authenticates the request, validates the Bearer token, and attaches the authenticated user to `request.user`. |
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

## Transactions and concurrency

Critical operations use explicit Prisma transactions:

- task transition: validate actor, access, and transition; update Task optimistically; insert audit entry;
- submission finalization: lock the Task row; finalize the latest draft; transition the Task to `SUBMITTED` in the same transaction;
- reviewer decision: transition the Task and complete the corresponding open Review in the same transaction;
- score mutation: validate the criterion and range; create or update `ReviewScore`; write real `before` and `after` values to AuditLog in the same transaction.

If any step fails, the transaction rolls back. This prevents a submitted Submission with an `IN_PROGRESS` task, or a `SUBMITTED` task with a draft Submission.

The repository deliberately uses two complementary concurrency mechanisms:

- **Optimistic locking** protects normal Task state transitions with `UPDATE ... WHERE id = taskId AND version = expectedVersion`. A stale request receives `409 CONCURRENT_MODIFICATION` without holding a database lock while the request is processed.
- **Row-level locking** (`SELECT ... FOR UPDATE`) is reserved for short critical sections that allocate the next monotonically increasing `Submission.version` or `RubricVersion.version`, and for submission finalization/draft updates that must not race each other.

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

`AuditLog` is append-only at the application layer. The application only inserts and reads audit records; it exposes no `PATCH` or `DELETE` audit endpoint. Production hardening could enforce immutable submissions and append-only auditing with restricted database permissions or PostgreSQL triggers.

[`ApiExceptionFilter`](src/common/filters/api-exception.filter.ts) normalizes domain exceptions, Nest HTTP exceptions, validation failures, Prisma known errors, and unexpected errors. It does not expose SQL, Prisma internals, stack traces, database credentials, or raw infrastructure errors.

```json
{
  "statusCode": 409,
  "code": "INVALID_STATE_TRANSITION",
  "message": "Transition ASSIGNED -> APPROVED is not allowed",
  "requestId": "a4c28baf-1b96-4c57-b315-1b8e5fbbf097"
}
```

Every request accepts `X-Request-ID`; if omitted, the API generates one and returns it in the response header and error payload.

## API and tests

List endpoints use `?page=1&limit=20`, with a maximum `limit` of 100, and return `{ data, meta }`.

- `POST /auth/login`
- `GET|POST /projects`, `POST /projects/:projectId/tasks`
- `GET /tasks`, `POST /tasks/:id/start|submit|request-rework|approve`
- `POST|GET /tasks/:taskId/submissions`, `PATCH /submissions/:id`, `GET /submissions/:id`
- `POST /projects/:projectId/rubrics`, `POST /rubrics/:rubricId/versions`
- `POST /submissions/:submissionId/reviews`, `GET|PUT /reviews`
- `GET /audit-logs` for admins

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

It covers login, project/task/rubric setup, assignment, v1 submission, scoring, rework, v2 submission, re-scoring, approval, immutable v1, exact rubric references, audit score history, and final Task status.

`dev-client/` is an optional API exerciser. The root TypeScript, ESLint, Jest, Docker, build, and runtime configurations do not depend on it, so it can be removed without affecting the backend.

## Scope and scaling limits

The sample deliberately excludes file storage, queues, Redis, microservices, Kubernetes, OAuth/SSO, and broad observability infrastructure.

The first practical pressure points at scale are AuditLog growth, large project/task list queries, offset pagination, PostgreSQL connection limits, concurrent writes to hot Tasks, and large Submission payloads. Likely next steps are cursor pagination and projections, audit retention or partitioning, object storage for documents, structured logs and metrics, and background processing for long-running model-evaluation work. A queue becomes appropriate only once those asynchronous workloads exist.
