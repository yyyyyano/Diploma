CREATE TABLE "privacy_consents" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"granted" boolean NOT NULL,
	"text_version" text NOT NULL,
	CONSTRAINT "privacy_consents_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "privacy_consents_kind_check" CHECK ("kind" in ('personal-data', 'cloud'))
);
--> statement-breakpoint
CREATE INDEX "privacy_consents_kind_idx" ON "privacy_consents" ("household_id","user_id","kind","created_at");