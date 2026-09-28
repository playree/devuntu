-- CreateEnum
CREATE TYPE "TicketRelationType" AS ENUM ('parent', 'related');

-- CreateTable
CREATE TABLE "ticket_relation" (
    "id" TEXT NOT NULL,
    "type" "TicketRelationType" NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_relation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_relation_toId_type_idx" ON "ticket_relation"("toId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_relation_type_fromId_toId_key" ON "ticket_relation"("type", "fromId", "toId");

-- AddForeignKey
ALTER TABLE "ticket_relation" ADD CONSTRAINT "ticket_relation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_relation" ADD CONSTRAINT "ticket_relation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
