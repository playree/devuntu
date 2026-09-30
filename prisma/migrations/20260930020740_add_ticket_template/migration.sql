-- CreateTable
CREATE TABLE "ticket_template" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "criteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tagIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "priority" "TicketPriority",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_template_boardId_name_key" ON "ticket_template"("boardId", "name");

-- AddForeignKey
ALTER TABLE "ticket_template" ADD CONSTRAINT "ticket_template_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
