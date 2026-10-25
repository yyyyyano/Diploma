CREATE TABLE "accounts" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"currency" text DEFAULT 'BYN' NOT NULL,
	"initial_balance_minor" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "accounts_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "accounts_kind_check" CHECK ("kind" in ('cash')),
	CONSTRAINT "accounts_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_cash_per_user_idx" ON "accounts" ("household_id","user_id") WHERE "kind" = 'cash';