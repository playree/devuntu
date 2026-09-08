-- AlterEnum
ALTER TYPE "NotifyChannel" ADD VALUE 'webpush';

-- AlterTable
ALTER TABLE "user_notify_setting" ADD COLUMN     "webpush" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "web_push_subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "label" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "web_push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscription_endpoint_key" ON "web_push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "web_push_subscription_userId_idx" ON "web_push_subscription"("userId");

-- AddForeignKey
ALTER TABLE "web_push_subscription" ADD CONSTRAINT "web_push_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
