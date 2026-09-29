-- CreateEnum
CREATE TYPE "TicketActivityField" AS ENUM ('created', 'title', 'content', 'status', 'priority', 'dueDate', 'assignee', 'tags', 'criteria');

-- CreateEnum
CREATE TYPE "TicketActivitySource" AS ENUM ('user', 'merge');

-- CreateTable
CREATE TABLE "ticket_activity" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT,
    "source" "TicketActivitySource" NOT NULL DEFAULT 'user',
    "field" "TicketActivityField" NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_activity_ticketId_createdAt_idx" ON "ticket_activity"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_activity_createdAt_idx" ON "ticket_activity"("createdAt");

-- AddForeignKey
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_activity" ADD CONSTRAINT "ticket_activity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
