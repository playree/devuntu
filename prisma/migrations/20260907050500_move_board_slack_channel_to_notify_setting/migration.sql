-- ボードに1つだけ持っていた通知先チャンネルを、イベントごとに持てる board_notify_setting へ移す。
-- 既存の設定はエージェント実行結果(agent_run)の通知先だったので、そのイベントの行として復元する。
-- 'agent_run' は既存の enum 値なので、この文の前に値を追加していなくても使える。
INSERT INTO "board_notify_setting" ("id", "boardId", "event", "slackChannelId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", 'agent_run', "slackChannelId", NOW(), NOW()
FROM "board"
WHERE "slackChannelId" IS NOT NULL
ON CONFLICT ("boardId", "event") DO NOTHING;

-- AlterTable
ALTER TABLE "board" DROP COLUMN "slackChannelId";

-- チャンネルの宛先は board_notify_setting から配信直前に引くようになったため、
-- トリガー側が渡す枠は使わない。
-- AlterTable
ALTER TABLE "notify_outbox" DROP COLUMN "targetSlackChannelIds";
