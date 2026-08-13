-- CreateEnum
CREATE TYPE "NotifyEvent" AS ENUM ('mention');

-- CreateTable
CREATE TABLE "user_notify_setting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" "NotifyEvent" NOT NULL,
    "slack" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notify_setting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_notify_setting_userId_event_key" ON "user_notify_setting"("userId", "event");

-- AddForeignKey
ALTER TABLE "user_notify_setting" ADD CONSTRAINT "user_notify_setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
