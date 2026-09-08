CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'REWORK_REQUESTED');

ALTER TABLE "User"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Review"
  ADD COLUMN "decision" "ReviewDecision";

ALTER TABLE "Assignment"
  ADD CONSTRAINT "Assignment_taskId_expertId_key" UNIQUE ("taskId", "expertId");

ALTER TABLE "Submission"
  ADD CONSTRAINT "Submission_version_positive" CHECK ("version" > 0);

ALTER TABLE "RubricVersion"
  ADD CONSTRAINT "RubricVersion_version_positive" CHECK ("version" > 0);

ALTER TABLE "RubricCriterion"
  ADD CONSTRAINT "RubricCriterion_score_range_valid" CHECK ("minScore" <= "maxScore"),
  ADD CONSTRAINT "RubricCriterion_weight_non_negative" CHECK ("weight" >= 0);
