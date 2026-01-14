-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Business" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBusinessRole" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBusinessRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "opening_balance_cents" BIGINT NOT NULL,
    "opening_balance_date" TIMESTAMPTZ(6) NOT NULL,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "payee" TEXT,
    "memo" TEXT,
    "amount_cents" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "method" TEXT,
    "category_id" UUID,
    "vendor_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_business_owner_user_id" ON "Business"("owner_user_id");

-- CreateIndex
CREATE INDEX "idx_ubr_user_id" ON "UserBusinessRole"("user_id");

-- CreateIndex
CREATE INDEX "idx_ubr_business_role" ON "UserBusinessRole"("business_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "user_business_role_business_id_user_id_key" ON "UserBusinessRole"("business_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_account_business_archived" ON "Account"("business_id", "archived_at");

-- CreateIndex
CREATE INDEX "idx_account_business_name" ON "Account"("business_id", "name");

-- CreateIndex
CREATE INDEX "idx_entry_business_account_date_created" ON "Entry"("business_id", "account_id", "date", "created_at");

-- CreateIndex
CREATE INDEX "idx_entry_business_account_deleted" ON "Entry"("business_id", "account_id", "deleted_at");

-- AddForeignKey
ALTER TABLE "UserBusinessRole" ADD CONSTRAINT "UserBusinessRole_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

