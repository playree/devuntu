-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotifyEvent" ADD VALUE 'ticket_created';
ALTER TYPE "NotifyEvent" ADD VALUE 'ticket_completed';

-- CreateTable
CREATE TABLE "board_notify_setting" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "event" "NotifyEvent" NOT NULL,
    "slackChannelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_notify_setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "board_notify_setting_boardId_event_key" ON "board_notify_setting"("boardId", "event");

-- AddForeignKey
ALTER TABLE "board_notify_setting" ADD CONSTRAINT "board_notify_setting_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
