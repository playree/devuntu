-- DropIndex
DROP INDEX "calendar_share_publicId_idx";

-- DropIndex
DROP INDEX "user_group_userId_idx";

-- 対応付けごとのシークレット導入前の行(空文字)と、対応付けを外した後に残った行は表示に使われないので消す
DELETE FROM "git_check_suite" s
WHERE NOT EXISTS (SELECT 1 FROM "board_repository" r WHERE r."id" = s."repositoryId");

-- AlterTable
ALTER TABLE "git_check_suite" ALTER COLUMN "repositoryId" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "git_check_suite_repositoryId_idx" ON "git_check_suite"("repositoryId");

-- AddForeignKey
ALTER TABLE "git_check_suite" ADD CONSTRAINT "git_check_suite_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "board_repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
