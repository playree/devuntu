-- CreateEnum
CREATE TYPE "TicketCommentType" AS ENUM ('plan', 'report');

-- AlterTable
ALTER TABLE "ticket_comment" ADD COLUMN     "parentId" TEXT,
ADD COLUMN     "type" "TicketCommentType";

-- CreateIndex
CREATE INDEX "ticket_comment_parentId_idx" ON "ticket_comment"("parentId");

-- AddForeignKey
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ticket_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
