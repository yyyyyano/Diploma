CREATE TABLE "recurring_items" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"series_key" text NOT NULL,
	"merchant_key" text,
	"name" text NOT NULL,
	"flow" text NOT NULL,
	"section" text NOT NULL,
	"period" text NOT NULL,
	"state" text NOT NULL,
	"source" text DEFAULT 'detected' NOT NULL,
	"anchor_day" integer,
	"manual_amount_minor" bigint,
	"occurrences" jsonb DEFAULT '[]' NOT NULL,
	"member_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"last_occurred_on" date,
	"next_expected_on" date NOT NULL,
	"ack_expected_on" date,
	"category_code" text,
	"category_id" uuid,
	"user_fixed" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "recurring_items_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "recurring_items_flow_check" CHECK ("flow" in ('income', 'expense')),
	CONSTRAINT "recurring_items_section_check" CHECK ("section" in ('income', 'mandatory', 'subscriptions', 'other')),
	CONSTRAINT "recurring_items_period_check" CHECK ("period" in ('week', 'month', 'quarter', 'year')),
	CONSTRAINT "recurring_items_state_check" CHECK ("state" in ('active', 'suggested', 'maybe-ended', 'ended', 'excluded')),
	CONSTRAINT "recurring_items_source_check" CHECK ("source" in ('detected', 'manual')),
	CONSTRAINT "recurring_items_day_check" CHECK ("anchor_day" is null or "anchor_day" between 1 and 31)
);
--> statement-breakpoint
CREATE TABLE "recurring_revisions" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"item_id" uuid NOT NULL,
	"existed" boolean NOT NULL,
	"section" text NOT NULL,
	"period" text NOT NULL,
	"state" text NOT NULL,
	"anchor_day" integer,
	"manual_amount_minor" bigint,
	"next_expected_on" date NOT NULL,
	"ack_expected_on" date,
	"user_fixed" text[] NOT NULL,
	CONSTRAINT "recurring_revisions_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_items_series_idx" ON "recurring_items" ("household_id","user_id","series_key");--> statement-breakpoint
CREATE INDEX "recurring_revisions_item_id_fk_idx" ON "recurring_revisions" ("household_id","item_id");--> statement-breakpoint
ALTER TABLE "recurring_revisions" ADD CONSTRAINT "recurring_revisions_item_id_fk" FOREIGN KEY ("household_id","item_id") REFERENCES "recurring_items"("household_id","id") ON DELETE CASCADE;