CREATE TABLE "legal_act_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"act_id" uuid NOT NULL,
	"text_hash" text NOT NULL,
	"raw_gz" bytea NOT NULL,
	"raw_bytes" integer NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "legal_act_snapshots_status_check" CHECK ("status" in ('applied','quarantined','pending'))
);
--> statement-breakpoint
CREATE TABLE "legal_acts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"pravo_id" text NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"is_npa" boolean DEFAULT true NOT NULL,
	"has_text" boolean NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text NOT NULL,
	"load_state" text DEFAULT 'pending' NOT NULL,
	"current_snapshot_id" uuid,
	"article_count" integer,
	"loaded_at" timestamp with time zone,
	"last_problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_acts_load_state_check" CHECK ("load_state" in ('pending','loaded','card-only','quarantined','failed')),
	CONSTRAINT "legal_acts_status_check" CHECK ("status" in ('active','repealed'))
);
--> statement-breakpoint
CREATE TABLE "legal_fetch_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"at" timestamp with time zone NOT NULL,
	"url" text NOT NULL,
	"http_status" integer,
	"bytes" integer,
	"ms" integer,
	"outcome" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_fragment_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"fragment_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"search_path" text NOT NULL,
	"heading" text,
	"body" text NOT NULL,
	"text_hash" text NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"first_snapshot_id" uuid NOT NULL,
	"last_snapshot_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_fragments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"act_id" uuid NOT NULL,
	"path_key" text NOT NULL,
	"article_no" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_loader_state" (
	"id" integer PRIMARY KEY,
	"last_request_at" timestamp with time zone,
	"next_request_at" timestamp with time zone,
	"stopped_until" timestamp with time zone,
	"stop_reason" text,
	"robots_txt" text,
	"robots_fetched_at" timestamp with time zone,
	"cycle_started_at" timestamp with time zone,
	"cycle_requests" integer DEFAULT 0 NOT NULL,
	"cycle_errors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "legal_loader_state_singleton_check" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "legal_update_log" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"at" timestamp with time zone NOT NULL,
	"act_id" uuid,
	"event" text NOT NULL,
	"details" jsonb DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "legal_act_snapshots_act_idx" ON "legal_act_snapshots" ("act_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_act_snapshots_hash_idx" ON "legal_act_snapshots" ("act_id","text_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_acts_pravo_id_idx" ON "legal_acts" ("pravo_id");--> statement-breakpoint
CREATE INDEX "legal_acts_source_state_idx" ON "legal_acts" ("source","load_state");--> statement-breakpoint
CREATE INDEX "legal_fetch_log_at_idx" ON "legal_fetch_log" ("at");--> statement-breakpoint
CREATE INDEX "legal_fragment_versions_fragment_idx" ON "legal_fragment_versions" ("fragment_id","is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_fragment_versions_current_idx" ON "legal_fragment_versions" ("fragment_id") WHERE "is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "legal_fragments_act_path_idx" ON "legal_fragments" ("act_id","path_key");--> statement-breakpoint
CREATE INDEX "legal_fragments_article_idx" ON "legal_fragments" ("act_id","article_no");--> statement-breakpoint
CREATE INDEX "legal_update_log_at_idx" ON "legal_update_log" ("at");--> statement-breakpoint
ALTER TABLE "legal_act_snapshots" ADD CONSTRAINT "legal_act_snapshots_act_id_legal_acts_id_fkey" FOREIGN KEY ("act_id") REFERENCES "legal_acts"("id");--> statement-breakpoint
ALTER TABLE "legal_fragment_versions" ADD CONSTRAINT "legal_fragment_versions_fragment_id_legal_fragments_id_fkey" FOREIGN KEY ("fragment_id") REFERENCES "legal_fragments"("id");--> statement-breakpoint
ALTER TABLE "legal_fragment_versions" ADD CONSTRAINT "legal_fragment_versions_yWuSAWd3sr5b_fkey" FOREIGN KEY ("first_snapshot_id") REFERENCES "legal_act_snapshots"("id");--> statement-breakpoint
ALTER TABLE "legal_fragment_versions" ADD CONSTRAINT "legal_fragment_versions_Hb7BmotgcrLT_fkey" FOREIGN KEY ("last_snapshot_id") REFERENCES "legal_act_snapshots"("id");--> statement-breakpoint
ALTER TABLE "legal_fragments" ADD CONSTRAINT "legal_fragments_act_id_legal_acts_id_fkey" FOREIGN KEY ("act_id") REFERENCES "legal_acts"("id");--> statement-breakpoint
ALTER TABLE "legal_update_log" ADD CONSTRAINT "legal_update_log_act_id_legal_acts_id_fkey" FOREIGN KEY ("act_id") REFERENCES "legal_acts"("id");
--> statement-breakpoint
-- Единственная строка состояния загрузчика (id = 1), как system_state у identity: код только обновляет её.
INSERT INTO "legal_loader_state" ("id") VALUES (1);
