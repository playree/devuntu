-- CreateTable
CREATE TABLE "group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "user_group" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_group_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_group_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "user_group_userId_idx" ON "user_group"("userId");

-- CreateIndex
CREATE INDEX "user_group_groupId_idx" ON "user_group"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "user_group_userId_groupId_key" ON "user_group"("userId", "groupId");
