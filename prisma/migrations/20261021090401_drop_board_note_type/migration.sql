/*
  Warnings:

  - You are about to drop the column `type` on the `board_note` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `board_note_revision` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "board_note" DROP COLUMN "type";

-- AlterTable
ALTER TABLE "board_note_revision" DROP COLUMN "type";

-- DropEnum
DROP TYPE "BoardNoteType";
