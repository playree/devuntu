-- AlterTable
ALTER TABLE "notify_delivery" ADD COLUMN     "failedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "notify_outbox" ADD COLUMN     "failedAt" TIMESTAMP(3);

-- 既存の failed 行は failedAt が null のままだと purge の条件に一致せず永久に残るため、
-- 起点を作成日時で埋める(遷移時刻は記録されていないので、これが得られる中で最も近い値)
UPDATE "notify_delivery" SET "failedAt" = "createdAt" WHERE "status" = 'failed' AND "failedAt" IS NULL;
UPDATE "notify_outbox" SET "failedAt" = "createdAt" WHERE "status" = 'failed' AND "failedAt" IS NULL;
