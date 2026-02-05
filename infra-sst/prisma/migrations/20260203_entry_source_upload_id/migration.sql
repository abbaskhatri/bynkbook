-- Minimal durable linkage for upload->entry (one upload creates at most one entry)
ALTER TABLE "entry" ADD COLUMN "source_upload_id" UUID;

CREATE UNIQUE INDEX "u_entry_scope_source_upload"
ON "entry" ("business_id", "source_upload_id");
