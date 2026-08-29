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

-- CreateIndex
CREATE INDEX "agent_approver_userId_idx" ON "agent_approver"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_approver_agentId_userId_key" ON "agent_approver"("agentId", "userId");

-- CreateIndex
CREATE INDEX "agent_approver_group_groupId_idx" ON "agent_approver_group"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_approver_group_agentId_groupId_key" ON "agent_approver_group"("agentId", "groupId");

-- AddForeignKey
ALTER TABLE "agent_approver" ADD CONSTRAINT "agent_approver_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approver" ADD CONSTRAINT "agent_approver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approver_group" ADD CONSTRAINT "agent_approver_group_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_approver_group" ADD CONSTRAINT "agent_approver_group_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "group"("id") ON DELETE CASCADE ON UPDATE CASCADE;
