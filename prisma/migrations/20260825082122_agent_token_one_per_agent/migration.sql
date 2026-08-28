-- 1エージェント1トークンへ移行する。失効済みの行と、同一ユーザーの古い行を先に落とす
DELETE FROM "agent_token" WHERE "revokedAt" IS NOT NULL;

DELETE FROM "agent_token" a
USING "agent_token" b
WHERE a."userId" = b."userId"
  AND (a."createdAt" < b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" < b."id"));

-- DropIndex
DROP INDEX "agent_token_userId_idx";

-- AlterTable
ALTER TABLE "agent_token" DROP COLUMN "name",
DROP COLUMN "revokedAt";

-- CreateIndex
CREATE UNIQUE INDEX "agent_token_userId_key" ON "agent_token"("userId");
