-- CreateEnum
CREATE TYPE "CommandRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "CommandStream" AS ENUM ('stdout', 'stderr', 'system');

-- CreateTable
CREATE TABLE "command_run" (
    "id" TEXT NOT NULL,
    "commandKey" TEXT NOT NULL,
    "commandLabel" TEXT NOT NULL,
    "hostLabel" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "argsPreview" TEXT NOT NULL,
    "status" "CommandRunStatus" NOT NULL DEFAULT 'queued',
    "activeKey" TEXT,
    "workerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelRequestedBy" TEXT,
    "exitCode" INTEGER,
    "failureKind" TEXT,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_run_chunk" (
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stream" "CommandStream" NOT NULL,
    "text" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_run_chunk_pkey" PRIMARY KEY ("runId","seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "command_run_activeKey_key" ON "command_run"("activeKey");

-- CreateIndex
CREATE INDEX "command_run_status_queuedAt_idx" ON "command_run"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "command_run_userId_queuedAt_idx" ON "command_run"("userId", "queuedAt");

-- CreateIndex
CREATE INDEX "command_run_commandKey_queuedAt_idx" ON "command_run"("commandKey", "queuedAt");

-- AddForeignKey
ALTER TABLE "command_run" ADD CONSTRAINT "command_run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_run_chunk" ADD CONSTRAINT "command_run_chunk_runId_fkey" FOREIGN KEY ("runId") REFERENCES "command_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
