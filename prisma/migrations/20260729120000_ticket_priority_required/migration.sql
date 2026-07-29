-- 既存の未設定(NULL)は「中」として扱う。NOT NULL 化の前に必ず埋める
UPDATE "ticket" SET "priority" = 'medium' WHERE "priority" IS NULL;

-- AlterTable
ALTER TABLE "ticket" ALTER COLUMN "priority" SET NOT NULL,
ALTER COLUMN "priority" SET DEFAULT 'medium';
