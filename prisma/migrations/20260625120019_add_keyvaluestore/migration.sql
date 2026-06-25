-- CreateTable
CREATE TABLE "key_value_store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "group" TEXT,
    "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "key_value_store_key_key" ON "key_value_store"("key");

-- CreateIndex
CREATE INDEX "key_value_store_group_idx" ON "key_value_store"("group");
