ALTER TABLE "Task" ALTER COLUMN "status" SET DEFAULT 'UNASSIGNED';

UPDATE "Task" AS task
SET "status" = 'UNASSIGNED'
WHERE task."status" = 'ASSIGNED'
  AND NOT EXISTS (
    SELECT 1 FROM "Assignment" AS assignment WHERE assignment."taskId" = task.id
  );
