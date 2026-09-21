-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AgentTaskMode" AS ENUM ('plan', 'auto');

-- CreateEnum
CREATE TYPE "AgentTaskState" AS ENUM ('queued', 'running', 'planned', 'done', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "AgentRunAction" AS ENUM ('plan', 'execute', 'revise');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('running', 'succeeded', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "BoardMemberRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "BoardKind" AS ENUM ('private', 'team');

-- CreateEnum
CREATE TYPE "TagColor" AS ENUM ('gray', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'indigo', 'violet', 'pink');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('backlog', 'todo', 'doing', 'done');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('urgent', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "TicketCommentType" AS ENUM ('plan', 'report');

-- CreateEnum
CREATE TYPE "NotifyEvent" AS ENUM ('mention', 'agent_run', 'ticket_assigned', 'ticket_created', 'ticket_completed');

-- CreateEnum
CREATE TYPE "NotifyChannel" AS ENUM ('email', 'slack', 'webpush');

-- CreateEnum
CREATE TYPE "NotifyJobStatus" AS ENUM ('pending', 'processing', 'done', 'failed');

-- CreateEnum
CREATE TYPE "CommandTargetMemberRole" AS ENUM ('owner', 'member');

-- CreateEnum
CREATE TYPE "CommandRunStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "CommandStream" AS ENUM ('stdout', 'stderr', 'system');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT,
    "banned" BOOLEAN DEFAULT false,
    "banReason" TEXT,
    "banExpires" TIMESTAMP(3),
    "twoFactorEnabled" BOOLEAN DEFAULT false,
    "nameLocked" BOOLEAN DEFAULT false,
    "locale" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "timezone" TEXT,
    "isAgent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_token" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runner" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "activeFromMin" INTEGER,
    "activeToMin" INTEGER,
    "timezone" TEXT,
    "pollIntervalSec" INTEGER NOT NULL DEFAULT 300,
    "rule" TEXT,
    "dailyRunLimit" INTEGER NOT NULL DEFAULT 0,
    "dailyResetMin" INTEGER NOT NULL DEFAULT 300,
    "lastPolledAt" TIMESTAMP(3),
    "hostname" TEXT,
    "version" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_runner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run" (
    "id" TEXT NOT NULL,
    "runnerId" TEXT NOT NULL,
    "ticketId" TEXT,
    "ticketRef" TEXT,
    "action" "AgentRunAction" NOT NULL,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'running',
    "summary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "agent_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_approver" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_approver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_approver_group" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_approver_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "impersonatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failedVerificationCount" INTEGER DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "two_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "aaguid" TEXT,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jwks" (
    "id" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "alg" TEXT,
    "crv" TEXT,

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "clientDiscoveryId" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skipConsent" BOOLEAN,
    "enableEndSession" BOOLEAN,
    "subjectType" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clientCredentialsScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT,
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tos" TEXT,
    "policy" TEXT,
    "softwareId" TEXT,
    "softwareVersion" TEXT,
    "softwareStatement" TEXT,
    "redirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "postLogoutRedirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "backchannelLogoutUri" TEXT,
    "backchannelLogoutSessionRequired" BOOLEAN,
    "tokenEndpointAuthMethod" TEXT,
    "applicationType" TEXT,
    "jwks" TEXT,
    "jwksUri" TEXT,
    "grantTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responseTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requirePKCE" BOOLEAN,
    "dpopBoundAccessTokens" BOOLEAN DEFAULT false,
    "referenceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_refresh_token" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "referenceId" TEXT,
    "authorizationCodeId" TEXT,
    "resources" TEXT[],
    "requestedUserInfoClaims" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "rotationReplayResponse" TEXT,
    "rotationReplayExpiresAt" TIMESTAMP(3),
    "authTime" TIMESTAMP(3),
    "confirmation" JSONB,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_access_token" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "referenceId" TEXT,
    "authorizationCodeId" TEXT,
    "resources" TEXT[],
    "requestedUserInfoClaims" TEXT[],
    "refreshId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revoked" TIMESTAMP(3),
    "confirmation" JSONB,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_access_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_consent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "referenceId" TEXT,
    "resources" TEXT[],
    "requestedUserInfoClaims" TEXT[],
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_resource" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" TEXT[],
    "customClaims" JSONB,
    "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "policyVersion" INTEGER DEFAULT 1,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "oauth_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client_resource" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3),

    CONSTRAINT "oauth_client_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_client_assertion" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_client_assertion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard" (
    "userId" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "link_widget" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "iconPath" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_widget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "originalName" TEXT NOT NULL,
    "boardId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_nonce" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_nonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_value_store" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "group" TEXT,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_value_store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_version" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "buildNo" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_group" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_share" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "options" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_busy_time" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "calendar_busy_time_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board" (
    "id" TEXT NOT NULL,
    "kind" "BoardKind" NOT NULL DEFAULT 'team',
    "privateOwnerId" TEXT,
    "key" TEXT NOT NULL,
    "ticketSeq" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_key_history" (
    "key" TEXT NOT NULL,
    "boardId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_key_history_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tag" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" "TagColor" NOT NULL DEFAULT 'gray',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_tag" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_member" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "BoardMemberRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_group" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "board_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "createdById" TEXT,
    "assigneeId" TEXT,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'todo',
    "priority" "TicketPriority" NOT NULL DEFAULT 'medium',
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "mentionedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agentMode" "AgentTaskMode",
    "agentState" "AgentTaskState",

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "content" TEXT NOT NULL,
    "type" "TicketCommentType",
    "parentId" TEXT,
    "mentionedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notify_setting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" "NotifyEvent" NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT false,
    "slack" BOOLEAN NOT NULL DEFAULT false,
    "webpush" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_notify_setting_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "board_notify_setting" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "event" "NotifyEvent" NOT NULL,
    "slackChannelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "board_notify_setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notify_outbox" (
    "id" TEXT NOT NULL,
    "event" "NotifyEvent" NOT NULL,
    "actorId" TEXT,
    "targetUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "payload" JSONB NOT NULL,
    "status" "NotifyJobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notify_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notify_delivery" (
    "id" TEXT NOT NULL,
    "outboxId" TEXT NOT NULL,
    "channel" "NotifyChannel" NOT NULL,
    "userId" TEXT,
    "slackChannelId" TEXT,
    "status" "NotifyJobStatus" NOT NULL DEFAULT 'pending',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notify_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_target_member" (
    "id" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CommandTargetMemberRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_target_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_target_group" (
    "id" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_target_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_run" (
    "id" TEXT NOT NULL,
    "commandKey" TEXT NOT NULL,
    "commandLabel" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "argsPreview" TEXT NOT NULL,
    "status" "CommandRunStatus" NOT NULL DEFAULT 'queued',
    "activeKey" TEXT,
    "workerId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "cancelRequestedBy" TEXT,
    "exitCode" INTEGER,
    "failureKind" TEXT,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "bytes" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "command_run_chunk" (
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "stream" "CommandStream" NOT NULL,
    "text" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "command_run_chunk_pkey" PRIMARY KEY ("runId","seq")
);

-- CreateIndex
CREATE INDEX "user_image_idx" ON "user"("image");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agent_token_userId_key" ON "agent_token"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_token_tokenHash_key" ON "agent_token"("tokenHash");

-- CreateIndex
CREATE INDEX "agent_token_createdById_idx" ON "agent_token"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_token_tokenHash_key" ON "mcp_token"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_token_userId_name_key" ON "mcp_token"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "agent_runner_userId_key" ON "agent_runner"("userId");

-- CreateIndex
CREATE INDEX "agent_run_runnerId_startedAt_idx" ON "agent_run"("runnerId", "startedAt");

-- CreateIndex
CREATE INDEX "agent_run_ticketId_idx" ON "agent_run"("ticketId");

-- CreateIndex
CREATE INDEX "agent_approver_userId_idx" ON "agent_approver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_approver_agentId_userId_key" ON "agent_approver"("agentId", "userId");

-- CreateIndex
CREATE INDEX "agent_approver_group_groupId_idx" ON "agent_approver_group"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_approver_group_agentId_groupId_key" ON "agent_approver_group"("agentId", "groupId");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "two_factor_secret_idx" ON "two_factor"("secret");

-- CreateIndex
CREATE INDEX "two_factor_userId_idx" ON "two_factor"("userId");

-- CreateIndex
CREATE INDEX "passkey_userId_idx" ON "passkey"("userId");

-- CreateIndex
CREATE INDEX "passkey_credentialID_idx" ON "passkey"("credentialID");

-- CreateIndex
CREATE INDEX "oauth_client_userId_idx" ON "oauth_client"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_client_clientId_key" ON "oauth_client"("clientId");

-- CreateIndex
CREATE INDEX "oauth_refresh_token_clientId_idx" ON "oauth_refresh_token"("clientId");

-- CreateIndex
CREATE INDEX "oauth_refresh_token_sessionId_idx" ON "oauth_refresh_token"("sessionId");

-- CreateIndex
CREATE INDEX "oauth_refresh_token_userId_idx" ON "oauth_refresh_token"("userId");

-- CreateIndex
CREATE INDEX "oauth_refresh_token_authorizationCodeId_idx" ON "oauth_refresh_token"("authorizationCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_refresh_token_token_key" ON "oauth_refresh_token"("token");

-- CreateIndex
CREATE INDEX "oauth_access_token_clientId_idx" ON "oauth_access_token"("clientId");

-- CreateIndex
CREATE INDEX "oauth_access_token_sessionId_idx" ON "oauth_access_token"("sessionId");

-- CreateIndex
CREATE INDEX "oauth_access_token_userId_idx" ON "oauth_access_token"("userId");

-- CreateIndex
CREATE INDEX "oauth_access_token_refreshId_idx" ON "oauth_access_token"("refreshId");

-- CreateIndex
CREATE INDEX "oauth_access_token_authorizationCodeId_idx" ON "oauth_access_token"("authorizationCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_access_token_token_key" ON "oauth_access_token"("token");

-- CreateIndex
CREATE INDEX "oauth_consent_clientId_idx" ON "oauth_consent"("clientId");

-- CreateIndex
CREATE INDEX "oauth_consent_userId_idx" ON "oauth_consent"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_resource_identifier_key" ON "oauth_resource"("identifier");

-- CreateIndex
CREATE INDEX "oauth_client_resource_clientId_idx" ON "oauth_client_resource"("clientId");

-- CreateIndex
CREATE INDEX "oauth_client_resource_resourceId_idx" ON "oauth_client_resource"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_client_resource_clientId_resourceId_key" ON "oauth_client_resource"("clientId", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "attachment_key_key" ON "attachment"("key");

-- CreateIndex
CREATE INDEX "attachment_boardId_idx" ON "attachment"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "upload_nonce_jti_key" ON "upload_nonce"("jti");

-- CreateIndex
CREATE INDEX "upload_nonce_expiresAt_idx" ON "upload_nonce"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "key_value_store_key_key" ON "key_value_store"("key");

-- CreateIndex
CREATE INDEX "key_value_store_group_idx" ON "key_value_store"("group");

-- CreateIndex
CREATE UNIQUE INDEX "app_version_version_key" ON "app_version"("version");

-- CreateIndex
CREATE INDEX "user_group_userId_idx" ON "user_group"("userId");

-- CreateIndex
CREATE INDEX "user_group_groupId_idx" ON "user_group"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "user_group_userId_groupId_key" ON "user_group"("userId", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_share_userId_key" ON "calendar_share"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_share_publicId_key" ON "calendar_share"("publicId");

-- CreateIndex
CREATE INDEX "calendar_share_publicId_idx" ON "calendar_share"("publicId");

-- CreateIndex
CREATE INDEX "calendar_busy_time_userId_idx" ON "calendar_busy_time"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "board_privateOwnerId_key" ON "board"("privateOwnerId");

-- CreateIndex
CREATE UNIQUE INDEX "board_key_key" ON "board"("key");

-- CreateIndex
CREATE INDEX "board_key_history_boardId_idx" ON "board_key_history"("boardId");

-- CreateIndex
CREATE UNIQUE INDEX "tag_boardId_name_key" ON "tag"("boardId", "name");

-- CreateIndex
CREATE INDEX "ticket_tag_tagId_idx" ON "ticket_tag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_tag_ticketId_tagId_key" ON "ticket_tag"("ticketId", "tagId");

-- CreateIndex
CREATE INDEX "board_member_userId_idx" ON "board_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "board_member_boardId_userId_key" ON "board_member"("boardId", "userId");

-- CreateIndex
CREATE INDEX "board_group_groupId_idx" ON "board_group"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "board_group_boardId_groupId_key" ON "board_group"("boardId", "groupId");

-- CreateIndex
CREATE INDEX "ticket_boardId_status_order_idx" ON "ticket"("boardId", "status", "order");

-- CreateIndex
CREATE INDEX "ticket_assigneeId_idx" ON "ticket"("assigneeId");

-- CreateIndex
CREATE INDEX "ticket_assigneeId_agentMode_idx" ON "ticket"("assigneeId", "agentMode");

-- CreateIndex
CREATE INDEX "ticket_createdById_idx" ON "ticket"("createdById");

-- CreateIndex
CREATE INDEX "ticket_updatedAt_idx" ON "ticket"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_boardId_number_key" ON "ticket"("boardId", "number");

-- CreateIndex
CREATE INDEX "ticket_comment_ticketId_createdAt_idx" ON "ticket_comment"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "ticket_comment_parentId_idx" ON "ticket_comment"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "user_notify_setting_userId_event_key" ON "user_notify_setting"("userId", "event");

-- CreateIndex
CREATE UNIQUE INDEX "web_push_subscription_endpoint_key" ON "web_push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "web_push_subscription_userId_idx" ON "web_push_subscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "board_notify_setting_boardId_event_key" ON "board_notify_setting"("boardId", "event");

-- CreateIndex
CREATE INDEX "notify_outbox_status_createdAt_idx" ON "notify_outbox"("status", "createdAt");

-- CreateIndex
CREATE INDEX "notify_delivery_channel_status_scheduledAt_idx" ON "notify_delivery"("channel", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "notify_delivery_userId_channel_status_scheduledAt_idx" ON "notify_delivery"("userId", "channel", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "notify_delivery_outboxId_idx" ON "notify_delivery"("outboxId");

-- CreateIndex
CREATE INDEX "command_target_member_userId_idx" ON "command_target_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "command_target_member_targetKey_userId_key" ON "command_target_member"("targetKey", "userId");

-- CreateIndex
CREATE INDEX "command_target_group_groupId_idx" ON "command_target_group"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "command_target_group_targetKey_groupId_key" ON "command_target_group"("targetKey", "groupId");

-- CreateIndex
CREATE UNIQUE INDEX "command_run_activeKey_key" ON "command_run"("activeKey");

-- CreateIndex
CREATE INDEX "command_run_status_queuedAt_idx" ON "command_run"("status", "queuedAt");

-- CreateIndex
CREATE INDEX "command_run_userId_queuedAt_idx" ON "command_run"("userId", "queuedAt");

-- CreateIndex
CREATE INDEX "command_run_commandKey_queuedAt_idx" ON "command_run"("commandKey", "queuedAt");

-- AddForeignKey
ALTER TABLE "agent_token" ADD CONSTRAINT "agent_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_token" ADD CONSTRAINT "agent_token_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_token" ADD CONSTRAINT "mcp_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runner" ADD CONSTRAINT "agent_runner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_runnerId_fkey" FOREIGN KEY ("runnerId") REFERENCES "agent_runner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approver" ADD CONSTRAINT "agent_approver_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approver" ADD CONSTRAINT "agent_approver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approver_group" ADD CONSTRAINT "agent_approver_group_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approver_group" ADD CONSTRAINT "agent_approver_group_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_client" ADD CONSTRAINT "oauth_client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_access_token" ADD CONSTRAINT "oauth_access_token_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "oauth_refresh_token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_consent" ADD CONSTRAINT "oauth_consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_client_resource" ADD CONSTRAINT "oauth_client_resource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "oauth_resource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard" ADD CONSTRAINT "dashboard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_group" ADD CONSTRAINT "user_group_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_group" ADD CONSTRAINT "user_group_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_share" ADD CONSTRAINT "calendar_share_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_busy_time" ADD CONSTRAINT "calendar_busy_time_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board" ADD CONSTRAINT "board_privateOwnerId_fkey" FOREIGN KEY ("privateOwnerId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_key_history" ADD CONSTRAINT "board_key_history_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag" ADD CONSTRAINT "tag_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tag" ADD CONSTRAINT "ticket_tag_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tag" ADD CONSTRAINT "ticket_tag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_group" ADD CONSTRAINT "board_group_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_group" ADD CONSTRAINT "board_group_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ticket_comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notify_setting" ADD CONSTRAINT "user_notify_setting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "web_push_subscription" ADD CONSTRAINT "web_push_subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "board_notify_setting" ADD CONSTRAINT "board_notify_setting_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notify_outbox" ADD CONSTRAINT "notify_outbox_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notify_delivery" ADD CONSTRAINT "notify_delivery_outboxId_fkey" FOREIGN KEY ("outboxId") REFERENCES "notify_outbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notify_delivery" ADD CONSTRAINT "notify_delivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_target_member" ADD CONSTRAINT "command_target_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_target_group" ADD CONSTRAINT "command_target_group_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_run" ADD CONSTRAINT "command_run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "command_run_chunk" ADD CONSTRAINT "command_run_chunk_runId_fkey" FOREIGN KEY ("runId") REFERENCES "command_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;
