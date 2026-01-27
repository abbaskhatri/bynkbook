-- CreateTable
CREATE TABLE "closed_period" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "business_id" UUID NOT NULL,
  "month" TEXT NOT NULL,
  "closed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "closed_by_user_id" TEXT NOT NULL,
  CONSTRAINT "closed_period_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "closed_period"
ADD CONSTRAINT "closed_period_business_id_fkey"
FOREIGN KEY ("business_id") REFERENCES "business"("id")
ON DELETE CASCADE ON UPDATE NO ACTION;

-- CreateIndex
CREATE UNIQUE INDEX "u_closed_period_scope_month" ON "closed_period"("business_id", "month");

-- CreateIndex
CREATE INDEX "i_closed_period_scope_month" ON "closed_period"("business_id", "month");
