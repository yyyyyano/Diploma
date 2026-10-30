CREATE TABLE "receipt_attempts" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"asked_lines" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"changed_lines" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"ok" boolean NOT NULL,
	"mismatches" jsonb DEFAULT '[]' NOT NULL,
	CONSTRAINT "receipt_attempts_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "receipt_attempts_attempt_check" CHECK ("attempt" >= 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_items" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"unit" text,
	"quantity_milli" bigint,
	"unit_price_minor" bigint,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"line_total_minor" bigint,
	"disputed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "receipt_items_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "receipt_items_position_check" CHECK ("position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"file_id" uuid NOT NULL,
	"status" text NOT NULL,
	"stage" text,
	"store_name" text,
	"store_key" text,
	"merchant_id" uuid,
	"unp" text,
	"address" text,
	"purchase_date" date,
	"purchase_time" text,
	"currency" text DEFAULT 'BYN' NOT NULL,
	"total_minor" bigint,
	"receipt_discount_minor" bigint DEFAULT 0 NOT NULL,
	"payment_method" text,
	"card_last4" text,
	"uid" text,
	"disputed_lines" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"mismatches" jsonb DEFAULT '[]' NOT NULL,
	"remainder_minor" bigint DEFAULT 0 NOT NULL,
	"rechecks" integer DEFAULT 0 NOT NULL,
	"trace_id" uuid,
	"prompt_version" text,
	"error_code" text,
	"duplicate_of" uuid,
	"recognized_at" timestamp with time zone,
	CONSTRAINT "receipts_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "receipts_status_check" CHECK ("status" in ('processing', 'ok', 'needs-review', 'failed')),
	CONSTRAINT "receipts_payment_check" CHECK ("payment_method" in ('cash', 'card')),
	CONSTRAINT "receipts_discount_check" CHECK ("receipt_discount_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_attempts_attempt_idx" ON "receipt_attempts" ("household_id","receipt_id","attempt");--> statement-breakpoint
CREATE INDEX "receipt_attempts_receipt_id_fk_idx" ON "receipt_attempts" ("household_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_items_position_idx" ON "receipt_items" ("household_id","receipt_id","position");--> statement-breakpoint
CREATE INDEX "receipt_items_receipt_id_fk_idx" ON "receipt_items" ("household_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_uid_idx" ON "receipts" ("household_id","uid");--> statement-breakpoint
CREATE INDEX "receipts_status_idx" ON "receipts" ("household_id","status","created_at");--> statement-breakpoint
CREATE INDEX "receipts_dedupe_idx" ON "receipts" ("household_id","store_key","purchase_date","total_minor");--> statement-breakpoint
ALTER TABLE "receipt_attempts" ADD CONSTRAINT "receipt_attempts_receipt_id_fk" FOREIGN KEY ("household_id","receipt_id") REFERENCES "receipts"("household_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD CONSTRAINT "receipt_items_receipt_id_fk" FOREIGN KEY ("household_id","receipt_id") REFERENCES "receipts"("household_id","id") ON DELETE CASCADE;