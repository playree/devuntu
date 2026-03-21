-- CreateTable
CREATE TABLE "jwks" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "expiresAt" DATETIME
);

-- CreateTable
CREATE TABLE "oauth_client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skipConsent" BOOLEAN,
    "enableEndSession" BOOLEAN,
    "subjectType" TEXT,
    "scopes" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME,
    "updatedAt" DATETIME,
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT,
    "tos" TEXT,
    "policy" TEXT,
    "softwareId" TEXT,
    "softwareVersion" TEXT,
    "softwareStatement" TEXT,
    "redirectUris" TEXT NOT NULL,
    "postLogoutRedirectUris" TEXT,
    "tokenEndpointAuthMethod" TEXT,
    "grantTypes" TEXT,
    "responseTypes" TEXT,
    "public" BOOLEAN,
    "type" TEXT,
    "requirePKCE" BOOLEAN,
    "referenceId" TEXT,
    "metadata" TEXT,
    CONSTRAINT "oauth_client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_refresh_token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "referenceId" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME,
    "revoked" DATETIME,
    "authTime" DATETIME,
    "scopes" TEXT NOT NULL,
    CONSTRAINT "oauth_refresh_token_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_client" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauth_refresh_token_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "oauth_refresh_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_access_token" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "referenceId" TEXT,
    "refreshId" TEXT,
    "expiresAt" DATETIME,
    "createdAt" DATETIME,
    "scopes" TEXT NOT NULL,
    CONSTRAINT "oauth_access_token_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_client" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauth_access_token_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "oauth_access_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauth_access_token_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "oauth_refresh_token" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_consent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "referenceId" TEXT,
    "scopes" TEXT NOT NULL,
    "createdAt" DATETIME,
    "updatedAt" DATETIME,
    CONSTRAINT "oauth_consent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_client" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "oauth_consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_client_clientId_key" ON "oauth_client"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_access_token_token_key" ON "oauth_access_token"("token");
