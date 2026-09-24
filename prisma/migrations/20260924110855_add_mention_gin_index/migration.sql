-- CreateIndex
CREATE INDEX "ticket_mentionedUserIds_idx" ON "ticket" USING GIN ("mentionedUserIds");

-- CreateIndex
CREATE INDEX "ticket_comment_mentionedUserIds_idx" ON "ticket_comment" USING GIN ("mentionedUserIds");
