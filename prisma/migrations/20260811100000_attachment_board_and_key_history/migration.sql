-- AlterTable
ALTER TABLE "attachment" ADD COLUMN     "boardId" TEXT;

-- CreateTable
CREATE TABLE "board_key_history" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_key_history_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "attachment_boardId_idx" ON "attachment"("boardId");

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 既存の添付をチケット本文から逆引きしてボードへ紐付ける。
-- key は `<uuidv7>.<拡張子>` で LIKE のワイルドカード(% _)を含まないためエスケープは不要
UPDATE "attachment" a
SET "boardId" = t."boardId"
FROM "ticket" t
WHERE a."boardId" IS NULL
  AND t."content" LIKE '%/api/upload/' || a."key" || '%';

-- コメント本文からも同様に逆引きする
UPDATE "attachment" a
SET "boardId" = t."boardId"
FROM "ticket_comment" c
JOIN "ticket" t ON t."id" = c."ticketId"
WHERE a."boardId" IS NULL
  AND c."content" LIKE '%/api/upload/' || a."key" || '%';

-- 既存ボードのキーを履歴へ登録する(移行前に手放されたキーは復元できないため対象外)
-- 競合対象を明示すると SELECT 側のスコープで "key" が解決されずエラーになるため対象は省略する
INSERT INTO "board_key_history" ("key", "createdAt")
SELECT b."key", b."createdAt" FROM "board" b
ON CONFLICT DO NOTHING;
