-- CreateTable
CREATE TABLE "calendar_share" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_share_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "calendar_share_userId_key" ON "calendar_share"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_share_publicId_key" ON "calendar_share"("publicId");

-- CreateIndex
CREATE INDEX "calendar_share_publicId_idx" ON "calendar_share"("publicId");

-- AddForeignKey
ALTER TABLE "calendar_share" ADD CONSTRAINT "calendar_share_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
