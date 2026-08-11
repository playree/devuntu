-- AlterTable
ALTER TABLE "board_key_history" ADD COLUMN     "boardId" TEXT;

-- CreateIndex
CREATE INDEX "board_key_history_boardId_idx" ON "board_key_history"("boardId");

-- AddForeignKey
ALTER TABLE "board_key_history" ADD CONSTRAINT "board_key_history_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 現在そのキーを使っているボードを持ち主として記録する
UPDATE "board_key_history" h
SET "boardId" = b."id"
FROM "board" b
WHERE h."boardId" IS NULL AND b."key" = h."key";
