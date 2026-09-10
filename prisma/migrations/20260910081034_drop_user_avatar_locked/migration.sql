-- AlterTable
ALTER TABLE "user" DROP COLUMN "avatarLocked";

-- CreateIndex
CREATE INDEX "user_image_idx" ON "user"("image");

