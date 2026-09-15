-- コマンド実行定義の第一階層を host から target へ改めたのに合わせ、履歴の列名も揃える
ALTER TABLE "command_run" RENAME COLUMN "hostLabel" TO "targetLabel";
