-- CreateTable
CREATE TABLE "app_version" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "buildNo" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_version_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_version_version_key" ON "app_version"("version");
