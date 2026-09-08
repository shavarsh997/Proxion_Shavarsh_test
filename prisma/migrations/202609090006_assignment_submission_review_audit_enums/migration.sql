-- Submission ownership is derived from Assignment. Existing rows are backfilled
-- from the previous task/expert pair before those duplicated columns are removed.
ALTER TABLE "Submission" ADD COLUMN "assignmentId" UUID;

UPDATE "Submission" AS submission
SET "assignmentId" = assignment.id
FROM "Assignment" AS assignment
WHERE assignment."taskId" = submission."taskId"
  AND assignment."expertId" = submission."expertId";

ALTER TABLE "Submission" ALTER COLUMN "assignmentId" SET NOT NULL;

DROP INDEX "Submission_taskId_createdAt_idx";
DROP INDEX "Submission_taskId_status_idx";
DROP INDEX "Submission_taskId_version_key";

ALTER TABLE "Submission"
  DROP CONSTRAINT "Submission_taskId_fkey",
  DROP CONSTRAINT "Submission_expertId_fkey",
  DROP COLUMN "taskId",
  DROP COLUMN "expertId",
  ADD CONSTRAINT "Submission_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Submission_assignmentId_version_key" ON "Submission"("assignmentId", "version");
CREATE INDEX "Submission_assignmentId_createdAt_idx" ON "Submission"("assignmentId", "createdAt");
CREATE INDEX "Submission_assignmentId_status_idx" ON "Submission"("assignmentId", "status");

-- ReviewStatus is a lifecycle only. Terminal legacy states become COMPLETED and
-- retain (or receive) the corresponding business decision.
ALTER TABLE "Review" ALTER COLUMN "status" DROP DEFAULT;

UPDATE "Review"
SET "decision" = 'APPROVED'
WHERE "status" = 'APPROVED' AND "decision" IS NULL;

UPDATE "Review"
SET "decision" = 'REWORK_REQUESTED'
WHERE "status" = 'REWORK_REQUESTED' AND "decision" IS NULL;

UPDATE "Review"
SET "status" = 'OPEN', "completedAt" = NULL
WHERE "status" = 'COMPLETED' AND "decision" IS NULL;

UPDATE "Review"
SET "status" = 'COMPLETED'
WHERE "status" IN ('APPROVED', 'REWORK_REQUESTED');

UPDATE "Review"
SET "completedAt" = "createdAt"
WHERE "status" = 'COMPLETED' AND "completedAt" IS NULL;

UPDATE "Review"
SET "decision" = NULL, "completedAt" = NULL
WHERE "status" = 'OPEN';

ALTER TYPE "ReviewStatus" RENAME TO "ReviewStatus_old";
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'COMPLETED');
ALTER TABLE "Review"
  ALTER COLUMN "status" TYPE "ReviewStatus"
  USING ("status"::text::"ReviewStatus");
DROP TYPE "ReviewStatus_old";
ALTER TABLE "Review" ALTER COLUMN "status" SET DEFAULT 'OPEN';
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_lifecycle_matches_decision"
  CHECK (
    ("status" = 'OPEN' AND "decision" IS NULL AND "completedAt" IS NULL)
    OR
    ("status" = 'COMPLETED' AND "decision" IS NOT NULL AND "completedAt" IS NOT NULL)
  );

-- Audit actions are constrained to the actions emitted by the application.
-- Legacy generic task transitions are mapped to the action that caused them.
UPDATE "AuditLog"
SET "action" = CASE
  WHEN "action" = 'CREATED' THEN 'REVIEW_SCORE_CREATED'
  WHEN "action" = 'UPDATED' THEN 'REVIEW_SCORE_UPDATED'
  WHEN "after"->>'status' = 'SUBMITTED' THEN 'SUBMISSION_SUBMITTED'
  WHEN "after"->>'status' = 'IN_REVIEW' THEN 'REVIEW_CREATED'
  WHEN "after"->>'status' = 'REWORK' THEN 'REVIEW_REWORK_REQUESTED'
  WHEN "after"->>'status' = 'APPROVED' THEN 'REVIEW_APPROVED'
  ELSE 'TASK_STARTED'
END
WHERE "action" IN ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'TASK_STATUS_CHANGED');

CREATE TYPE "AuditAction" AS ENUM (
  'PROJECT_CREATED',
  'TASK_CREATED',
  'EXPERT_ASSIGNED',
  'TASK_STARTED',
  'SUBMISSION_CREATED',
  'SUBMISSION_UPDATED',
  'SUBMISSION_SUBMITTED',
  'RUBRIC_CREATED',
  'RUBRIC_VERSION_CREATED',
  'REVIEW_CREATED',
  'REVIEW_SCORE_CREATED',
  'REVIEW_SCORE_UPDATED',
  'REVIEW_APPROVED',
  'REVIEW_REWORK_REQUESTED'
);

ALTER TABLE "AuditLog"
  ALTER COLUMN "action" TYPE "AuditAction"
  USING ("action"::"AuditAction");
