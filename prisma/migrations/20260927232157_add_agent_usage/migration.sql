-- AlterTable
ALTER TABLE "agent_run" ADD COLUMN     "cachedInputTokens" INTEGER,
ADD COLUMN     "costUsd" DECIMAL(12,6),
ADD COLUMN     "exitCode" INTEGER,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "measuredAt" TIMESTAMP(3),
ADD COLUMN     "model" TEXT,
ADD COLUMN     "outputTokens" INTEGER;

-- AlterTable
ALTER TABLE "agent_runner" ADD COLUMN     "monthlyBudgetUsd" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "agent_usage" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "boardId" TEXT,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "cachedInputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_usage_runnerId_month_idx" ON "agent_usage"("runnerId", "month");

-- CreateIndex
CREATE INDEX "agent_usage_boardId_idx" ON "agent_usage"("boardId");

-- AddForeignKey
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "agent_runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_usage" ADD CONSTRAINT "agent_usage_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
