-- CreateEnum
CREATE TYPE "TicketCommentDecision" AS ENUM ('approved', 'rejected');

-- AlterTable
ALTER TABLE "ticket_comment" ADD COLUMN     "decision" "TicketCommentDecision";

-- CreateTable
CREATE TABLE "ticket_criterion" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "agentMet" BOOLEAN,
    "agentEvidence" TEXT,
    "agentReportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_criterion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_criterion_ticketId_order_idx" ON "ticket_criterion"("ticketId", "order");

-- AddForeignKey
ALTER TABLE "ticket_criterion" ADD CONSTRAINT "ticket_criterion_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_criterion" ADD CONSTRAINT "ticket_criterion_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
