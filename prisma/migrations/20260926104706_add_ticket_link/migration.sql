-- CreateEnum
CREATE TYPE "GitProvider" AS ENUM ('github');

-- CreateEnum
CREATE TYPE "TicketLinkKind" AS ENUM ('branch', 'pull_request', 'commit');

-- CreateEnum
CREATE TYPE "PullRequestState" AS ENUM ('open', 'draft', 'merged', 'closed');

-- CreateEnum
CREATE TYPE "TicketLinkSource" AS ENUM ('manual', 'auto');

-- AlterTable
ALTER TABLE "board" ADD COLUMN     "completeOnPrMerge" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ticket_link" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "provider" "GitProvider" NOT NULL DEFAULT 'github',
    "kind" "TicketLinkKind" NOT NULL,
    "repo" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "prState" "PullRequestState",
    "headSha" TEXT,
    "syncedAt" TIMESTAMP(3),
    "source" "TicketLinkSource" NOT NULL DEFAULT 'manual',
    "dismissed" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_repository" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "provider" "GitProvider" NOT NULL DEFAULT 'github',
    "repo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_repository_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "git_check_suite" (
    "id" TEXT NOT NULL,
    "provider" "GitProvider" NOT NULL DEFAULT 'github',
    "repo" TEXT NOT NULL,
    "suiteId" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "appName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "conclusion" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_check_suite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_link_provider_repo_kind_ref_idx" ON "ticket_link"("provider", "repo", "kind", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_link_ticketId_provider_repo_kind_ref_key" ON "ticket_link"("ticketId", "provider", "repo", "kind", "ref");

-- CreateIndex
CREATE INDEX "board_repository_provider_repo_idx" ON "board_repository"("provider", "repo");

-- CreateIndex
CREATE UNIQUE INDEX "board_repository_boardId_provider_repo_key" ON "board_repository"("boardId", "provider", "repo");

-- CreateIndex
CREATE INDEX "git_check_suite_provider_repo_headSha_idx" ON "git_check_suite"("provider", "repo", "headSha");

-- CreateIndex
CREATE INDEX "git_check_suite_updatedAt_idx" ON "git_check_suite"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "git_check_suite_provider_repo_suiteId_key" ON "git_check_suite"("provider", "repo", "suiteId");

-- AddForeignKey
ALTER TABLE "ticket_link" ADD CONSTRAINT "ticket_link_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_link" ADD CONSTRAINT "ticket_link_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_repository" ADD CONSTRAINT "board_repository_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
