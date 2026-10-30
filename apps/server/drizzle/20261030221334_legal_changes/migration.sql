CREATE TABLE "legal_demand_loads" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"act_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_pending_changes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"act_id" uuid NOT NULL,
	"change_key" text NOT NULL,
	"description" text NOT NULL,
	"in_force_on" date,
	"articles" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"analyzed_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	CONSTRAINT "legal_pending_changes_status_check" CHECK ("status" in ('pending','reflected'))
);
--> statement-breakpoint
ALTER TABLE "legal_acts" ADD COLUMN "repealed_on" date;--> statement-breakpoint
ALTER TABLE "legal_acts" ADD COLUMN "card_checked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "legal_demand_loads_at_idx" ON "legal_demand_loads" ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_pending_changes_key_idx" ON "legal_pending_changes" ("act_id","change_key");--> statement-breakpoint
ALTER TABLE "legal_demand_loads" ADD CONSTRAINT "legal_demand_loads_act_id_legal_acts_id_fkey" FOREIGN KEY ("act_id") REFERENCES "legal_acts"("id");--> statement-breakpoint
ALTER TABLE "legal_pending_changes" ADD CONSTRAINT "legal_pending_changes_act_id_legal_acts_id_fkey" FOREIGN KEY ("act_id") REFERENCES "legal_acts"("id");