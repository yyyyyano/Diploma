CREATE TABLE "files" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	CONSTRAINT "files_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "files_kind_check" CHECK ("kind" in ('data-export', 'receipt-photo', 'statement')),
	CONSTRAINT "files_size_check" CHECK ("size" >= 0)
);
--> statement-breakpoint
CREATE INDEX "files_kind_idx" ON "files" ("household_id","kind","created_at");