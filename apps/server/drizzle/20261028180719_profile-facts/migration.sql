CREATE TABLE "profile_fact_revisions" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fact_id" uuid NOT NULL,
	"existed" boolean NOT NULL,
	"value" jsonb NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"status" text NOT NULL,
	"recorded_on" date NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "profile_fact_revisions_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "profile_facts" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"key" text NOT NULL,
	"topic" text NOT NULL,
	"value" jsonb NOT NULL,
	"source" text NOT NULL,
	"source_ref" text,
	"status" text NOT NULL,
	"recorded_on" date NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "profile_facts_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "profile_facts_source_check" CHECK ("source" in ('questionnaire', 'chat', 'statements', 'system', 'user')),
	CONSTRAINT "profile_facts_status_check" CHECK ("status" in ('confirmed', 'assumed'))
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"onboarding_done_at" timestamp with time zone,
	CONSTRAINT "profiles_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE INDEX "profile_fact_revisions_fact_id_fk_idx" ON "profile_fact_revisions" ("household_id","fact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_facts_key_idx" ON "profile_facts" ("household_id","user_id","key") WHERE "key" <> 'note';--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_user_idx" ON "profiles" ("household_id","user_id");--> statement-breakpoint
ALTER TABLE "profile_fact_revisions" ADD CONSTRAINT "profile_fact_revisions_fact_id_fk" FOREIGN KEY ("household_id","fact_id") REFERENCES "profile_facts"("household_id","id") ON DELETE CASCADE;