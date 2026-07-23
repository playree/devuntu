/*
  Warnings:

  - Made the column `token` on table `oauth_access_token` required. This step will fail if there are existing NULL values in that column.
  - Made the column `expiresAt` on table `oauth_access_token` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdAt` on table `oauth_access_token` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdAt` on table `oauth_consent` required. This step will fail if there are existing NULL values in that column.
  - Made the column `updatedAt` on table `oauth_consent` required. This step will fail if there are existing NULL values in that column.
  - Made the column `expiresAt` on table `oauth_refresh_token` required. This step will fail if there are existing NULL values in that column.
  - Made the column `createdAt` on table `oauth_refresh_token` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "oauth_access_token" ALTER COLUMN "token" SET NOT NULL,
ALTER COLUMN "expiresAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "oauth_consent" ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "updatedAt" SET NOT NULL;

-- AlterTable
ALTER TABLE "oauth_refresh_token" ALTER COLUMN "expiresAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET NOT NULL,
ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;
