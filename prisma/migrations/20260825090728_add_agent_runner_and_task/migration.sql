-- CreateEnum
CREATE TYPE "AgentTaskMode" AS ENUM ('plan', 'auto');

-- CreateEnum
CREATE TYPE "AgentTaskState" AS ENUM ('queued', 'running', 'planned', 'done', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "AgentRunAction" AS ENUM ('plan', 'execute', 'revise');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('running', 'succeeded', 'failed', 'skipped');

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "agentMode" "AgentTaskMode",
ADD COLUMN     "agentState" "AgentTaskState";

-- CreateTable
CREATE TABLE "agent_runner" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "activeFromMin" INTEGER,
    "activeToMin" INTEGER,
    "timezone" TEXT,
    "pollIntervalSec" INTEGER NOT NULL DEFAULT 300,
    "defaultMode" "AgentTaskMode" NOT NULL DEFAULT 'plan',
    "preTask" TEXT,
    "postTask" TEXT,
    "lastPolledAt" TIMESTAMP(3),
    "hostname" TEXT,
    "version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "ticketId" TEXT,
    "ticketRef" TEXT,
    "action" "AgentRunAction" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'running',
    "summary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_runner_userId_key" ON "agent_runner"("userId");

-- CreateIndex
CREATE INDEX "agent_run_runnerId_startedAt_idx" ON "agent_run"("runnerId", "startedAt");

-- CreateIndex
CREATE INDEX "agent_run_ticketId_idx" ON "agent_run"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_assigneeId_agentMode_idx" ON "ticket"("assigneeId", "agentMode");

-- AddForeignKey
ALTER TABLE "agent_runner" ADD CONSTRAINT "agent_runner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "agent_runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
