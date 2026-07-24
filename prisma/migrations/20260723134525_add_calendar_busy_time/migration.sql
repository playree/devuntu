-- CreateTable
CREATE TABLE "calendar_busy_time" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_busy_time_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "calendar_busy_time_userId_idx" ON "calendar_busy_time"("userId");

-- AddForeignKey
ALTER TABLE "calendar_busy_time" ADD CONSTRAINT "calendar_busy_time_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
