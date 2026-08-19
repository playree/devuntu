-- AlterTable
-- account の識別子が accountId 単独から (issuer, accountId) になったため、
-- NULL 許容で追加 -> providerId ごとにバックフィル -> NOT NULL 化 の順で入れる。
ALTER TABLE "account" ADD COLUMN     "issuer" TEXT;

-- 値は各プロバイダ定義に対応させる(組み込み social / slack() プリセットは
-- ライブラリ側が issuer を持ち、genericOAuth の2つは auth.ts で明示している)。
UPDATE "account" SET "issuer" = 'local:credential'             WHERE "providerId" = 'credential';
UPDATE "account" SET "issuer" = 'https://accounts.google.com'  WHERE "providerId" = 'google';
UPDATE "account" SET "issuer" = 'https://slack.com'            WHERE "providerId" = 'slack';
UPDATE "account" SET "issuer" = 'local:oauth:google-account'   WHERE "providerId" = 'google-account';
UPDATE "account" SET "issuer" = 'local:oauth:devuntu'          WHERE "providerId" = 'devuntu';

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;

-- AlterTable
ALTER TABLE "jwks" ADD COLUMN     "alg" TEXT,
ADD COLUMN     "crv" TEXT;

-- AlterTable
ALTER TABLE "oauth_access_token" ADD COLUMN     "authorizationCodeId" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requestedUserInfoClaims" TEXT[],
ADD COLUMN     "resources" TEXT[],
ADD COLUMN     "revoked" TIMESTAMP(3);

-- AlterTable
-- public / type は廃止され tokenEndpointAuthMethod / applicationType に置き換わったので、
-- DROP する前に値を移送する。
UPDATE "oauth_client" SET "tokenEndpointAuthMethod" = 'none' WHERE "public" = true AND "tokenEndpointAuthMethod" IS NULL;

ALTER TABLE "oauth_client" ADD COLUMN "applicationType" TEXT;
UPDATE "oauth_client" SET "applicationType" = "type" WHERE "type" IS NOT NULL;

ALTER TABLE "oauth_client" DROP COLUMN "public",
DROP COLUMN "type",
ADD COLUMN     "backchannelLogoutSessionRequired" BOOLEAN,
ADD COLUMN     "backchannelLogoutUri" TEXT,
ADD COLUMN     "clientCredentialsScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "clientDiscoveryId" TEXT,
ADD COLUMN     "dpopBoundAccessTokens" BOOLEAN DEFAULT false,
ADD COLUMN     "jwks" TEXT,
ADD COLUMN     "jwksUri" TEXT;

-- AlterTable
ALTER TABLE "oauth_consent" ADD COLUMN     "requestedUserInfoClaims" TEXT[],
ADD COLUMN     "resources" TEXT[];

-- AlterTable
ALTER TABLE "oauth_refresh_token" ADD COLUMN     "authorizationCodeId" TEXT,
ADD COLUMN     "confirmation" JSONB,
ADD COLUMN     "requestedUserInfoClaims" TEXT[],
ADD COLUMN     "resources" TEXT[],
ADD COLUMN     "rotatedAt" TIMESTAMP(3),
ADD COLUMN     "rotationReplayExpiresAt" TIMESTAMP(3),
ADD COLUMN     "rotationReplayResponse" TEXT;

-- CreateTable
CREATE TABLE "oauth_resource" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" TEXT[],
    "customClaims" JSONB,
    "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),
    "policyVersion" INTEGER DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "oauth_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client_resource" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "oauth_client_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client_assertion" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_client_assertion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_resource_identifier_key" ON "oauth_resource"("identifier");

-- CreateIndex
CREATE INDEX "oauth_client_resource_clientId_idx" ON "oauth_client_resource"("clientId");

-- CreateIndex
CREATE INDEX "oauth_client_resource_resourceId_idx" ON "oauth_client_resource"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_client_resource_clientId_resourceId_key" ON "oauth_client_resource"("clientId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "account_issuer_accountId_key" ON "account"("issuer", "accountId");

-- CreateIndex
CREATE INDEX "oauth_access_token_authorizationCodeId_idx" ON "oauth_access_token"("authorizationCodeId");

-- CreateIndex
CREATE INDEX "oauth_refresh_token_authorizationCodeId_idx" ON "oauth_refresh_token"("authorizationCodeId");

-- AddForeignKey
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "oauth_resource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;
