-- CreateTable
CREATE TABLE "wiki_template" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "type" "WikiPageType" NOT NULL DEFAULT 'page',
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wiki_template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wiki_template_spaceId_name_key" ON "wiki_template"("spaceId", "name");

-- AddForeignKey
ALTER TABLE "wiki_template" ADD CONSTRAINT "wiki_template_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "wiki_space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_template" ADD CONSTRAINT "wiki_template_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wiki_template" ADD CONSTRAINT "wiki_template_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
