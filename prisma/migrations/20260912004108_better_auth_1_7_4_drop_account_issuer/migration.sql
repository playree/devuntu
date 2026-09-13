-- better-auth 1.7.3 で account の識別子が (issuer, accountId) から (providerId, accountId) へ
-- 戻され、issuer は書き込まれなくなった。NOT NULL のまま残すとサインアップと
-- アカウント連携が全て失敗し、起動時のスキーマ検証にも弾かれるため列ごと削除する。

-- DropIndex
DROP INDEX "account_issuer_accountId_key";

-- AlterTable
ALTER TABLE "account" DROP COLUMN "issuer";
