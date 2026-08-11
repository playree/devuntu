-- AlterTable: ボードキーと採番カウンタ(既存行を埋めるため key は一旦 NULL 許容で追加する)
ALTER TABLE "board" ADD COLUMN     "key" TEXT;
ALTER TABLE "board" ADD COLUMN     "ticketSeq" INTEGER NOT NULL DEFAULT 0;

-- 既存ボードの暫定キー。team は B<連番>、プライベートは PRV<連番>(作成順)
UPDATE "board" AS b
SET "key" = s.prefix || s.seq
FROM (
  SELECT
    id,
    CASE WHEN kind = 'private' THEN 'PRV' ELSE 'B' END AS prefix,
    ROW_NUMBER() OVER (PARTITION BY (kind = 'private') ORDER BY "createdAt", id) AS seq
  FROM "board"
) AS s
WHERE b.id = s.id;

ALTER TABLE "board" ALTER COLUMN "key" SET NOT NULL;

-- AlterTable: チケットのボード内連番(既存行を埋めるため一旦 NULL 許容で追加する)
ALTER TABLE "ticket" ADD COLUMN     "number" INTEGER;

-- 既存チケットへボードごとの連番を作成順で振る
UPDATE "ticket" AS t
SET "number" = s.seq
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "boardId" ORDER BY "createdAt", id) AS seq
  FROM "ticket"
) AS s
WHERE t.id = s.id;

ALTER TABLE "ticket" ALTER COLUMN "number" SET NOT NULL;

-- 採番カウンタを既存の最大番号へ合わせる(チケットが無いボードは 0 のまま)
UPDATE "board" AS b
SET "ticketSeq" = m.max_number
FROM (
  SELECT "boardId", MAX("number") AS max_number FROM "ticket" GROUP BY "boardId"
) AS m
WHERE b.id = m."boardId";

-- CreateIndex
CREATE UNIQUE INDEX "board_key_key" ON "board"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_boardId_number_key" ON "ticket"("boardId", "number");
