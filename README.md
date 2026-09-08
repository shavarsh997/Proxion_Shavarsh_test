# Proxion Workflow API

Proxion is a focused NestJS/PostgreSQL API for an expert-review workflow. It manages projects, expert assignments, versioned submissions, immutable rubric versions, criterion-level reviews, JWT authentication, and an append-only audit trail.

The backend is a modular monolith: one deployable NestJS application and one PostgreSQL database. Modules draw clear domain boundaries without introducing distributed-system infrastructure.

`dev-client/` is an optional, isolated API exerciser. The root build, tests, linting, type checking, Docker image, and runtime do not depend on it; it can be deleted without affecting the backend.

## Run locally

Docker Compose starts PostgreSQL, applies migrations, loads deterministic demo data, and starts the API:

```bash
docker compose up --build
```

The API is available at `http://localhost:3000`, Swagger at `http://localhost:3000/api/docs`, and the database health check at `GET /health`.

For local development, set `DATABASE_URL` and `JWT_SECRET` in `.env`, then run:

```bash
npm install
npx prisma migrate deploy
npx prisma db seed # optional demo data
npm run start:dev
```

Compose sets `SEED_ON_START=true` because it is the work-sample environment. The image defaults it to `false`: migrations run at startup, but production restarts do not automatically seed data. Demo accounts use `Password123!`: `admin@proxion.local`, `expert@proxion.local`, and `reviewer@proxion.local`.

```bash
npm run check
```

Runs type checking, ESLint, Prettier verification, and unit tests. The complete live-API workflow test requires a running seeded API:

```bash
npm run test:e2e
```

Set `E2E_BASE_URL` when the API is not on `http://127.0.0.1:3000`.

## Request architecture

```text
HTTP request
  → request-id middleware
  → JWT authentication guard
  → role authorization guard
  → controller (route, DTO, Swagger metadata)
  → service / access policy / TaskWorkflowService
  → Prisma transaction where the operation is atomic
  → PostgreSQL + AuditLog
  → normalized HTTP response with requestId
```

- **Authentication:** `JwtAuthGuard` verifies the Bearer token issued by `AuthService` after bcrypt password verification.
- **Role authorization:** `RolesGuard` applies `ADMIN`, `EXPERT`, and `REVIEWER` restrictions declared by `@Roles`.
- **Resource authorization:** `TaskAccessPolicy` and `ReviewAccessPolicy` check task assignment and review ownership inside services. Client state never authorizes a resource.
- **Business invariants:** services validate state, ownership, versioning, rubric compatibility, and score ranges. `TaskWorkflowService` is the only authority that changes `Task.status`.
- **Persistence and auditability:** `PrismaService` is the single database client. Critical changes create their audit entry in the same database transaction.

Every request accepts an optional `X-Request-ID`; otherwise the API creates one. The ID is returned in the response header and in normalized errors:

```json
{
  "statusCode": 409,
  "code": "INVALID_STATE_TRANSITION",
  "message": "Transition ASSIGNED -> APPROVED is not allowed",
  "requestId": "a4c28baf-1b96-4c57-b315-1b8e5fbbf097"
}
```

## Modules

```text
Users ──→ Auth
  │
  ├──→ Tasks ←── Submissions
  │       ↑
  │       └────── Reviews
  │
Projects ──→ Tasks
    │
    └──────→ Rubrics ──→ Reviews

Prisma (global module) ←── all domain services
AuditLog ←── workflow transitions and review-score mutations
```

Each domain module uses the same local structure: `*.module.ts`, `*.controller.ts`, `*.service.ts`, a `*.policy.ts` only when it has resource access rules, and `dto/` for request DTOs. Shared infrastructure is intentionally limited to `common/auth`, `common/http`, `common/exceptions`, and `common/types`.

## Workflow and atomicity

```text
ASSIGNED → IN_PROGRESS → SUBMITTED → IN_REVIEW → APPROVED (terminal)
                                  └─→ REWORK → IN_PROGRESS
```

There is no `REWORK → APPROVED` transition. An expert must create and submit a new version, and an admin must create a new review before a reviewer can approve it.

`TaskWorkflowService` defines the complete transition map in one place. It updates `Task` with an optimistic `id + version` predicate, then creates `AuditLog.STATUS_CHANGED` in the same transaction. A stale concurrent request returns `409 CONCURRENT_MODIFICATION`; an audit failure rolls the state change back.

Critical transaction boundaries are intentionally visible in the domain services:

- task transition + task audit entry;
- submission finalization + task transition;
- reviewer rework/approval + review completion + task transition;
- review-score upsert + audit entry;
- submission and rubric version allocation under a parent-row lock.

## Versioning and historical data

```text
Project
 ├── Task ──→ Submission v1 (SUBMITTED, immutable)
 │             Submission v2 (DRAFT → SUBMITTED, immutable)
 └── Rubric ─→ RubricVersion 1 ─→ criteria
               RubricVersion 2 ─→ criteria

Review ──→ one Submission version + one exact RubricVersion
```

`UNIQUE(taskId, version)` is the database invariant for submissions. Version allocation, draft updates, and finalization lock the same `Task` row, so a draft cannot be updated concurrently with finalization. `PATCH /submissions/:id` accepts changes only from the draft author while its task is `IN_PROGRESS`. A `SUBMITTED` version raises `SUBMISSION_IMMUTABLE`; no submission delete endpoint exists. After rework, the expert creates v2 instead of overwriting v1.

Rubrics are versioned through `UNIQUE(rubricId, version)`. A review permanently stores `rubricVersionId`, while scores permanently store their criterion ID, so a later rubric version cannot silently alter historical scoring context. There is no API to update or delete historical rubric versions or criteria.

`AuditLog` has no public update or delete API and is append-only by application design. A production deployment can harden both submitted-submission immutability and audit append-only behavior further with database permissions or triggers.

## API behavior

List endpoints use `?page=1&limit=20` with a maximum limit of 100 and return `{ data, meta }`. Important routes include:

- `POST /auth/login`
- `GET|POST /projects`, `POST /projects/:projectId/tasks`
- `GET /tasks`, `POST /tasks/:id/start|submit|request-rework|approve`
- `POST|GET /tasks/:taskId/submissions`, `PATCH /submissions/:id`, `GET /submissions/:id`
- `POST /projects/:projectId/rubrics`, `POST /rubrics/:rubricId/versions`
- `POST /submissions/:submissionId/reviews`, `GET|PUT /reviews`
- `GET /audit-logs` (admin only)

Global DTO validation rejects unknown fields and validates UUIDs and pagination values. Expected errors use stable `400`, `401`, `403`, `404`, and `409` responses; Prisma internals are never exposed.

## Scope

The sample intentionally excludes file storage, queues, Redis, microservices, Kubernetes, OAuth/SSO, and a full observability platform. Practical next steps for higher volume would be object storage for large submissions, cursor pagination, audit retention/partitioning, database-level immutability controls, refresh-token revocation, and structured request logs.
