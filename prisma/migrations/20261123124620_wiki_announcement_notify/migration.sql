-- CreateEnum
CREATE TYPE "WikiAnnouncementNotifyKind" AS ENUM ('published', 'updated');

-- CreateEnum
CREATE TYPE "WikiAnnouncementNotifyStatus" AS ENUM ('scheduled', 'sent', 'canceled', 'skipped');

-- CreateEnum
CREATE TYPE "WikiAnnouncementNotifySkipReason" AS ENUM ('archived', 'not_announcement', 'channel_unset', 'slack_disabled', 'no_permission', 'page_deleted');

-- AlterEnum
ALTER TYPE "NotifyEvent" ADD VALUE 'wiki_announcement';

-- AlterTable
ALTER TABLE "wiki_space" ADD COLUMN     "announceSlackChannelId" TEXT;

-- CreateTable
CREATE TABLE "wiki_announcement_notify" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "kind" "WikiAnnouncementNotifyKind" NOT NULL,
    "message" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "WikiAnnouncementNotifyStatus" NOT NULL,
    "sentAt" TIMESTAMP(3),
    "skipReason" "WikiAnnouncementNotifySkipReason",
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_announcement_notify_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wiki_announcement_notify_status_scheduledAt_idx" ON "wiki_announcement_notify"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "wiki_announcement_notify_pageId_createdAt_idx" ON "wiki_announcement_notify"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "wiki_announcement_notify_spaceId_idx" ON "wiki_announcement_notify"("spaceId");

-- CreateIndex
CREATE INDEX "wiki_announcement_notify_createdById_idx" ON "wiki_announcement_notify"("createdById");

-- AddForeignKey
ALTER TABLE "wiki_announcement_notify" ADD CONSTRAINT "wiki_announcement_notify_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_announcement_notify" ADD CONSTRAINT "wiki_announcement_notify_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
