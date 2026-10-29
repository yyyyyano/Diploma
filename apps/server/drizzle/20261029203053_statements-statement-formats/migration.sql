CREATE TABLE "statement_formats" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fingerprint" text NOT NULL,
	"source_kind" text NOT NULL,
	"bank" text,
	"bank_key" text,
	"schema" jsonb NOT NULL,
	"used_count" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp with time zone NOT NULL,
	CONSTRAINT "statement_formats_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "statement_formats_fingerprint_check" CHECK ("fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "statement_formats_kind_check" CHECK ("source_kind" in ('csv', 'xlsx', 'xls', 'pdf')),
	CONSTRAINT "statement_formats_used_check" CHECK ("used_count" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "statement_formats_fingerprint_idx" ON "statement_formats" ("household_id","fingerprint");--> statement-breakpoint
CREATE INDEX "statement_formats_bank_idx" ON "statement_formats" ("household_id","bank_key");