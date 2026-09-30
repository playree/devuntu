-- AlterTable
ALTER TABLE "board" DROP COLUMN "agentAutoRevise",
DROP COLUMN "agentAutoReviseLimit",
DROP COLUMN "completeOnGithubMerge",
DROP COLUMN "completeOnGitlabMerge";

-- CreateTable
CREATE TABLE "board_git_setting" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "provider" "GitProvider" NOT NULL,
    "completeOnMerge" BOOLEAN NOT NULL DEFAULT false,
    "autoRevise" BOOLEAN NOT NULL DEFAULT false,
    "autoReviseLimit" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_git_setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "board_git_setting_boardId_provider_key" ON "board_git_setting"("boardId", "provider");

-- AddForeignKey
ALTER TABLE "board_git_setting" ADD CONSTRAINT "board_git_setting_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

