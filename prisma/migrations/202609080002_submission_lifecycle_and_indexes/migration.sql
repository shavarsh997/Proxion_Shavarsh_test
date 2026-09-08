CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED');

ALTER TABLE "Submission"
  ADD COLUMN "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "Submission"
SET "status" = 'SUBMITTED'
WHERE "submittedAt" IS NOT NULL;

CREATE INDEX "Assignment_taskId_idx" ON "Assignment"("taskId");
CREATE INDEX "Submission_taskId_status_idx" ON "Submission"("taskId", "status");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
