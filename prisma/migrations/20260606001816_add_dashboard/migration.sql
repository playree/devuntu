-- CreateTable
CREATE TABLE "dashboard" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "layout" JSONB NOT NULL,
    "createdAt" DATETIME,
    "updatedAt" DATETIME,
    CONSTRAINT "dashboard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
