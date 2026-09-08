-- CreateEnum
CREATE TYPE "NotifyChannel" AS ENUM ('email', 'slack');

-- CreateEnum
CREATE TYPE "NotifyJobStatus" AS ENUM ('pending', 'processing', 'done', 'failed');

-- AlterEnum
ALTER TYPE "NotifyEvent" ADD VALUE 'agent_run';

-- CreateTable
CREATE TABLE "notify_outbox" (
    "id" TEXT NOT NULL,
    "event" "NotifyEvent" NOT NULL,
    "actorId" TEXT,
    "targetUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetSlackChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payload" JSONB NOT NULL,
    "status" "NotifyJobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notify_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notify_delivery" (
    "id" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "channel" "NotifyChannel" NOT NULL,
    "userId" TEXT,
    "slackChannelId" TEXT,
    "status" "NotifyJobStatus" NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notify_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notify_outbox_status_createdAt_idx" ON "notify_outbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notify_delivery_channel_status_scheduledAt_idx" ON "notify_delivery"("channel", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "notify_delivery_userId_channel_status_scheduledAt_idx" ON "notify_delivery"("userId", "channel", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "notify_delivery_outboxId_idx" ON "notify_delivery"("outboxId");

-- AddForeignKey
ALTER TABLE "notify_outbox" ADD CONSTRAINT "notify_outbox_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notify_delivery" ADD CONSTRAINT "notify_delivery_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "notify_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notify_delivery" ADD CONSTRAINT "notify_delivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
