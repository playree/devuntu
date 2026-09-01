-- CreateTable
CREATE TABLE "upload_nonce" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_nonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "upload_nonce_jti_key" ON "upload_nonce"("jti");

-- CreateIndex
CREATE INDEX "upload_nonce_expiresAt_idx" ON "upload_nonce"("expiresAt");
