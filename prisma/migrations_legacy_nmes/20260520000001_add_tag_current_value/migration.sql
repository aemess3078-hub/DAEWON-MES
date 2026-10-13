-- CreateTable
CREATE TABLE "TagCurrentValue" (
    "id" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "numericValue" DECIMAL(18,6),
    "quality" TEXT NOT NULL DEFAULT 'GOOD',
    "timestamp" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagCurrentValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TagCurrentValue_tagId_key" ON "TagCurrentValue"("tagId");

-- AddForeignKey
ALTER TABLE "TagCurrentValue" ADD CONSTRAINT "TagCurrentValue_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "DataTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
