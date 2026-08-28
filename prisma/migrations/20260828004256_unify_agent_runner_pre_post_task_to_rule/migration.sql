-- AlterTable: introduce the unified `rule` column
ALTER TABLE "agent_runner" ADD COLUMN "rule" TEXT;

-- Merge existing preTask/postTask into rule (both instructions kept when both existed)
UPDATE "agent_runner"
SET "rule" = CASE
  WHEN "preTask" IS NOT NULL AND "postTask" IS NOT NULL THEN "preTask" || E'\n\n' || "postTask"
  ELSE COALESCE("preTask", "postTask")
END;

-- AlterTable: drop the old separate columns
ALTER TABLE "agent_runner" DROP COLUMN "preTask",
DROP COLUMN "postTask";
