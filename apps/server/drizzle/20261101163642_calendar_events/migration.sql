CREATE TABLE "calendar_events" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"rule" text,
	"day" date,
	"amount_minor" bigint,
	"currency" text DEFAULT 'BYN' NOT NULL,
	"origin" text NOT NULL,
	"params" jsonb DEFAULT '{}' NOT NULL,
	"ref_entity" text,
	"ref_id" uuid,
	"key" text,
	"remind_days" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"on_edited" boolean DEFAULT false NOT NULL,
	CONSTRAINT "calendar_events_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "calendar_events_type_check" CHECK ("type" in ('own', 'tax', 'insurance', 'credit', 'warranty')),
	CONSTRAINT "calendar_events_origin_check" CHECK ("origin" in ('user', 'chat', 'warranty', 'rule', 'insurance')),
	CONSTRAINT "calendar_events_amount_check" CHECK ("amount_minor" is null or "amount_minor" >= 0),
	CONSTRAINT "calendar_events_day_check" CHECK ("day" is not null or "rule" is not null)
);
--> statement-breakpoint
CREATE TABLE "calendar_reminders" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"offset_days" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "calendar_reminders_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "calendar_reminders_status_check" CHECK ("status" in ('pending', 'sent', 'skipped')),
	CONSTRAINT "calendar_reminders_offset_check" CHECK ("offset_days" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_events_key_idx" ON "calendar_events" ("household_id","user_id","key");--> statement-breakpoint
CREATE INDEX "calendar_events_day_idx" ON "calendar_events" ("household_id","user_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_reminders_event_idx" ON "calendar_reminders" ("household_id","event_id","offset_days");--> statement-breakpoint
CREATE INDEX "calendar_reminders_due_idx" ON "calendar_reminders" ("status","due_at");--> statement-breakpoint
CREATE INDEX "calendar_reminders_event_id_fk_idx" ON "calendar_reminders" ("household_id","event_id");--> statement-breakpoint
ALTER TABLE "calendar_reminders" ADD CONSTRAINT "calendar_reminders_event_id_fk" FOREIGN KEY ("household_id","event_id") REFERENCES "calendar_events"("household_id","id") ON DELETE CASCADE;