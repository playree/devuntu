-- CreateEnum
CREATE TYPE "TicketChildAdvance" AS ENUM ('done', 'reported');

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "childAdvance" "TicketChildAdvance" NOT NULL DEFAULT 'done';

-- AlterTable
ALTER TABLE "ticket_comment" ADD COLUMN     "proposal" JSONB;
