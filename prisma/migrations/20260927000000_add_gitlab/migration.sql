-- CreateEnum
CREATE TYPE "GitWebhookAuth" AS ENUM ('signing', 'token');

-- AlterEnum
ALTER TYPE "GitProvider" ADD VALUE 'gitlab';

-- DropIndex
DROP INDEX "board_repository_boardId_provider_repo_key";

-- DropIndex
DROP INDEX "board_repository_provider_repo_idx";

-- DropIndex
DROP INDEX "git_check_suite_provider_repo_headSha_idx";

-- DropIndex
DROP INDEX "git_check_suite_provider_repo_suiteId_key";

-- DropIndex
DROP INDEX "ticket_link_provider_repo_kind_ref_idx";

-- DropIndex
DROP INDEX "ticket_link_ticketId_provider_repo_kind_ref_key";

-- AlterTable
ALTER TABLE "board_repository" ADD COLUMN     "baseUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastReceivedAt" TIMESTAMP(3),
ADD COLUMN     "webhookAuth" "GitWebhookAuth",
ADD COLUMN     "webhookSecret" TEXT;

-- AlterTable
ALTER TABLE "git_check_suite" ADD COLUMN     "baseUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "repositoryId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "ticket_link" ADD COLUMN     "baseUrl" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "board_repository_provider_baseUrl_repo_idx" ON "board_repository"("provider", "baseUrl", "repo");

-- CreateIndex
CREATE UNIQUE INDEX "board_repository_boardId_provider_baseUrl_repo_key" ON "board_repository"("boardId", "provider", "baseUrl", "repo");

-- CreateIndex
CREATE INDEX "git_check_suite_provider_baseUrl_repo_headSha_idx" ON "git_check_suite"("provider", "baseUrl", "repo", "headSha");

-- CreateIndex
CREATE UNIQUE INDEX "git_check_suite_provider_baseUrl_repo_suiteId_repositoryId_key" ON "git_check_suite"("provider", "baseUrl", "repo", "suiteId", "repositoryId");

-- CreateIndex
CREATE INDEX "ticket_link_provider_baseUrl_repo_kind_ref_idx" ON "ticket_link"("provider", "baseUrl", "repo", "kind", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_link_ticketId_provider_baseUrl_repo_kind_ref_key" ON "ticket_link"("ticketId", "provider", "baseUrl", "repo", "kind", "ref");

