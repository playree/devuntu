-- CreateTable
CREATE TABLE "mcp_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mcp_token_tokenHash_key" ON "mcp_token"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_token_userId_name_key" ON "mcp_token"("userId", "name");

-- AddForeignKey
ALTER TABLE "mcp_token" ADD CONSTRAINT "mcp_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
