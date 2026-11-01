CREATE TABLE "weekly_preferences" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"weekday" smallint,
	"time" text,
	CONSTRAINT "weekly_preferences_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "weekly_preferences_weekday_check" CHECK ("weekday" is null or "weekday" between 1 and 7),
	CONSTRAINT "weekly_preferences_time_check" CHECK ("time" is null or "time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "weekly_summaries" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"facts" jsonb,
	"text" text DEFAULT '' NOT NULL,
	"text_source" text DEFAULT 'template' NOT NULL,
	CONSTRAINT "weekly_summaries_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "weekly_summaries_status_check" CHECK ("status" in ('ok', 'empty')),
	CONSTRAINT "weekly_summaries_source_check" CHECK ("text_source" in ('model', 'template'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_preferences_owner_idx" ON "weekly_preferences" ("household_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_summaries_week_idx" ON "weekly_summaries" ("household_id","user_id","week_start");