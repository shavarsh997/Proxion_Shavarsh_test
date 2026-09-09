-- A Task has one lifecycle, so it can have only one active expert assignment.
CREATE UNIQUE INDEX "Assignment_taskId_key" ON "Assignment"("taskId");

-- A submitted version is immutable history. Only one editable draft may exist for an assignment.
CREATE UNIQUE INDEX "Submission_one_draft_per_assignment_key"
  ON "Submission"("assignmentId")
  WHERE "status" = 'DRAFT';

-- Every Task state transition is represented by one explicit append-only audit event.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TASK_STATUS_CHANGED';
