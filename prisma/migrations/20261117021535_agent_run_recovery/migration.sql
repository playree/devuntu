-- AlterTable
ALTER TABLE "agent_run" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "agentStateAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_runnerId_requestId_key" ON "agent_run"("runnerId", "requestId");
