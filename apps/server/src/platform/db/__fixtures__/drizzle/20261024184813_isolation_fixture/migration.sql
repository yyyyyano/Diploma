-- Тестовая схема механизма изоляции (__fixtures__/schema.ts), сгенерирована drizzle-kit. Правка руками:
-- ON DELETE SET NULL ("receipt_id") — drizzle-kit пишет SET NULL всех колонок составного ключа, и удаление
-- чека упиралось бы в NOT NULL household_id (ADR-0007, ARCHITECTURE §15).
CREATE TABLE "fx_rates" (
	"code" text PRIMARY KEY,
	"rate_micros" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_receipt_items" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sum_minor" bigint NOT NULL,
	CONSTRAINT "fx_receipt_items_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "fx_receipts" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merchant" text NOT NULL,
	"total_minor" bigint NOT NULL,
	"status" text DEFAULT 'recognizing' NOT NULL,
	"note" text,
	CONSTRAINT "fx_receipts_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "fx_settings" (
	"key" text PRIMARY KEY,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_transactions" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"description" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"receipt_id" uuid,
	CONSTRAINT "fx_transactions_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE INDEX "fx_receipt_items_receipt_id_fk_idx" ON "fx_receipt_items" ("household_id","receipt_id");--> statement-breakpoint
CREATE INDEX "fx_transactions_receipt_id_fk_idx" ON "fx_transactions" ("household_id","receipt_id");--> statement-breakpoint
ALTER TABLE "fx_receipt_items" ADD CONSTRAINT "fx_receipt_items_receipt_id_fk" FOREIGN KEY ("household_id","receipt_id") REFERENCES "fx_receipts"("household_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "fx_transactions" ADD CONSTRAINT "fx_transactions_receipt_id_fk" FOREIGN KEY ("household_id","receipt_id") REFERENCES "fx_receipts"("household_id","id") ON DELETE SET NULL ("receipt_id");