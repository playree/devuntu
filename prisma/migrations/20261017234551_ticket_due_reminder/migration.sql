-- CreateEnum
CREATE TYPE "DueRemindKind" AS ENUM ('day_before', 'due_day');

-- AlterEnum
ALTER TYPE "NotifyEvent" ADD VALUE 'ticket_due';

-- CreateTable
CREATE TABLE "ticket_due_reminder" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "kind" "DueRemindKind" NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_due_reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_due_reminder_dueDate_idx" ON "ticket_due_reminder"("dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_due_reminder_ticketId_kind_dueDate_key" ON "ticket_due_reminder"("ticketId", "kind", "dueDate");

-- CreateIndex
CREATE INDEX "ticket_dueDate_idx" ON "ticket"("dueDate");

-- AddForeignKey
ALTER TABLE "ticket_due_reminder" ADD CONSTRAINT "ticket_due_reminder_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
