ALTER TABLE "transactions" ADD COLUMN "import_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
CREATE INDEX "transactions_dedupe_idx" ON "transactions" ("household_id","dedupe_key") WHERE "dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "transactions_external_idx" ON "transactions" ("household_id","external_id") WHERE "external_id" is not null;--> statement-breakpoint
CREATE INDEX "transactions_import_idx" ON "transactions" ("household_id","import_id") WHERE "import_id" is not null;