CREATE TABLE "action_journal" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handler" text NOT NULL,
	"payload" jsonb NOT NULL,
	"subject" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "action_journal_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "action_journal_status_check" CHECK ("status" in ('done', 'undone')),
	CONSTRAINT "action_journal_channel_check" CHECK ("channel" in ('web', 'telegram'))
);
--> statement-breakpoint
CREATE TABLE "pending_decisions" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"handler" text NOT NULL,
	"payload" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"channel" text,
	"answered_at" timestamp with time zone,
	CONSTRAINT "pending_decisions_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "pending_decisions_status_check" CHECK ("status" in ('pending', 'yes', 'no')),
	CONSTRAINT "pending_decisions_channel_check" CHECK ("channel" is null or "channel" in ('web', 'telegram'))
);
--> statement-breakpoint
CREATE TABLE "explanations" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace" jsonb NOT NULL,
	"period_from" date,
	"period_to" date,
	CONSTRAINT "explanations_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE INDEX "action_journal_subject_idx" ON "action_journal" ("household_id","subject","created_at");