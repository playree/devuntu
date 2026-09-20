-- CreateTable
CREATE TABLE "command_setting" (
    "id" TEXT NOT NULL,
    "commandKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_allowed_group" (
    "id" TEXT NOT NULL,
    "settingId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_allowed_group_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "command_setting_commandKey_key" ON "command_setting"("commandKey");

-- CreateIndex
CREATE INDEX "command_allowed_group_groupId_idx" ON "command_allowed_group"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "command_allowed_group_settingId_groupId_key" ON "command_allowed_group"("settingId", "groupId");

-- AddForeignKey
ALTER TABLE "command_allowed_group" ADD CONSTRAINT "command_allowed_group_settingId_fkey" FOREIGN KEY ("settingId") REFERENCES "command_setting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_allowed_group" ADD CONSTRAINT "command_allowed_group_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
