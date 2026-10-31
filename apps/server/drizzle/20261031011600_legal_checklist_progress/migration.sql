CREATE TABLE "checklist_progress" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checklist_id" text NOT NULL,
	"subject" text NOT NULL,
	"item_id" text NOT NULL,
	CONSTRAINT "checklist_progress_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "checklist_progress_ids_check" CHECK ("checklist_id" ~ '^[a-z][a-z0-9-]{0,40}$' and "item_id" ~ '^[a-z][a-z0-9-]{0,40}$'),
	CONSTRAINT "checklist_progress_subject_check" CHECK ("subject" ~ '^(general|(message|deduction):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_progress_item_idx" ON "checklist_progress" ("household_id","checklist_id","subject","item_id");