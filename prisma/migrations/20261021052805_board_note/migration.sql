-- CreateEnum
CREATE TYPE "BoardNoteKind" AS ENUM ('knowledge', 'memory');

-- CreateEnum
CREATE TYPE "BoardNoteVia" AS ENUM ('web', 'mcp');

-- CreateEnum
CREATE TYPE "BoardNoteRevisionAction" AS ENUM ('created', 'updated', 'deleted', 'restored');

-- CreateTable
CREATE TABLE "board_note" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "kind" "BoardNoteKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "updatedVia" "BoardNoteVia" NOT NULL DEFAULT 'web',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_note_revision" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "action" "BoardNoteRevisionAction" NOT NULL,
    "kind" "BoardNoteKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "actorId" TEXT,
    "via" "BoardNoteVia" NOT NULL,
    "ticketId" TEXT,
    "restoredFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_note_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_note_boardId_kind_idx" ON "board_note"("boardId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "board_note_boardId_name_key" ON "board_note"("boardId", "name");

-- CreateIndex
CREATE INDEX "board_note_revision_noteId_createdAt_idx" ON "board_note_revision"("noteId", "createdAt");

-- CreateIndex
CREATE INDEX "board_note_revision_boardId_createdAt_idx" ON "board_note_revision"("boardId", "createdAt");

-- CreateIndex
CREATE INDEX "board_note_revision_createdAt_idx" ON "board_note_revision"("createdAt");

-- CreateIndex
CREATE INDEX "board_note_revision_ticketId_idx" ON "board_note_revision"("ticketId");

-- AddForeignKey
ALTER TABLE "board_note" ADD CONSTRAINT "board_note_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_note" ADD CONSTRAINT "board_note_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_note" ADD CONSTRAINT "board_note_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_note_revision" ADD CONSTRAINT "board_note_revision_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_note_revision" ADD CONSTRAINT "board_note_revision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_note_revision" ADD CONSTRAINT "board_note_revision_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
