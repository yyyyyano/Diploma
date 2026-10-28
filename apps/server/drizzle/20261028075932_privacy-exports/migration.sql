CREATE TABLE "privacy_exports" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"file_id" uuid,
	"file_name" text,
	"size" bigint,
	"finished_at" timestamp with time zone,
	CONSTRAINT "privacy_exports_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "privacy_exports_status_check" CHECK ("status" in ('pending', 'ready', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_exports_one_pending_idx" ON "privacy_exports" ("household_id") WHERE "status" = 'pending';