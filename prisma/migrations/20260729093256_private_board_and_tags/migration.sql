-- CreateEnum
CREATE TYPE "BoardKind" AS ENUM ('private', 'team');

-- CreateEnum
CREATE TYPE "TagColor" AS ENUM ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink');

-- DropForeignKey
ALTER TABLE "ticket" DROP CONSTRAINT "ticket_ownerId_fkey";

-- DropIndex
DROP INDEX "ticket_ownerId_status_order_idx";

-- AlterTable
ALTER TABLE "board" ADD COLUMN     "kind" "BoardKind" NOT NULL DEFAULT 'team',
ADD COLUMN     "privateOwnerId" TEXT;

-- AlterTable
ALTER TABLE "ticket" DROP COLUMN "ownerId",
DROP COLUMN "tags",
ALTER COLUMN "boardId" SET NOT NULL;

-- CreateTable
CREATE TABLE "tag" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" "TagColor" NOT NULL DEFAULT 'gray',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_tag" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_tag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tag_boardId_name_key" ON "tag"("boardId", "name");

-- CreateIndex
CREATE INDEX "ticket_tag_tagId_idx" ON "ticket_tag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_tag_ticketId_tagId_key" ON "ticket_tag"("ticketId", "tagId");

-- CreateIndex
CREATE UNIQUE INDEX "board_privateOwnerId_key" ON "board"("privateOwnerId");

-- AddForeignKey
ALTER TABLE "board" ADD CONSTRAINT "board_privateOwnerId_fkey" FOREIGN KEY ("privateOwnerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag" ADD CONSTRAINT "tag_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tag" ADD CONSTRAINT "ticket_tag_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tag" ADD CONSTRAINT "ticket_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
