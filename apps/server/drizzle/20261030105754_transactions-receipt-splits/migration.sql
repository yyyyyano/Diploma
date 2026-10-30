CREATE TABLE "transaction_splits" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"category_code" text,
	"category_id" uuid,
	"amount_minor" bigint NOT NULL,
	CONSTRAINT "transaction_splits_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "transaction_splits_amount_check" CHECK ("amount_minor" > 0),
	CONSTRAINT "transaction_splits_category_check" CHECK (num_nonnulls("category_code", "category_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "receipt_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "needs_review" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "transaction_splits_position_idx" ON "transaction_splits" ("household_id","transaction_id","position");--> statement-breakpoint
CREATE INDEX "transaction_splits_transaction_id_fk_idx" ON "transaction_splits" ("household_id","transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_receipt_idx" ON "transactions" ("household_id","receipt_id") WHERE "receipt_id" is not null;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_transaction_id_fk" FOREIGN KEY ("household_id","transaction_id") REFERENCES "transactions"("household_id","id") ON DELETE CASCADE;--> statement-breakpoint
-- Составные FK на категории написаны руками (T-028): Drizzle-схема transactions не видит чужие таблицы; как у transactions.
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_category_id_fk" FOREIGN KEY ("household_id","category_id") REFERENCES "categories"("household_id","id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "transaction_splits_category_id_fk_idx" ON "transaction_splits" ("household_id","category_id") WHERE "category_id" is not null;--> statement-breakpoint
ALTER TABLE "transaction_splits" ADD CONSTRAINT "transaction_splits_category_code_fk" FOREIGN KEY ("category_code") REFERENCES "system_categories"("code");
