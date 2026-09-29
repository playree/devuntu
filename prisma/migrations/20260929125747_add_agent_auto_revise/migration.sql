-- CreateEnum
CREATE TYPE "AgentAutoReviseSource" AS ENUM ('ci', 'review');

-- AlterTable
ALTER TABLE "board" ADD COLUMN     "agentAutoRevise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agentAutoReviseLimit" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "agentAutoReviseCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "agent_auto_revise_trigger" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "source" "AgentAutoReviseSource" NOT NULL,
    "provider" "GitProvider" NOT NULL,
    "baseUrl" TEXT NOT NULL DEFAULT '',
    "repo" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "checks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "body" TEXT,
    "author" TEXT,
    "reviewState" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "runId" TEXT,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_auto_revise_trigger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_auto_revise_trigger_ticketId_consumed_idx" ON "agent_auto_revise_trigger"("ticketId", "consumed");

-- CreateIndex
CREATE INDEX "agent_auto_revise_trigger_runId_idx" ON "agent_auto_revise_trigger"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_auto_revise_trigger_ticketId_dedupeKey_key" ON "agent_auto_revise_trigger"("ticketId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "agent_auto_revise_trigger" ADD CONSTRAINT "agent_auto_revise_trigger_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_auto_revise_trigger" ADD CONSTRAINT "agent_auto_revise_trigger_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;
