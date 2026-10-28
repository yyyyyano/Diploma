CREATE TABLE "account_revisions" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"existed" boolean NOT NULL,
	"name" text,
	"initial_balance_minor" bigint NOT NULL,
	CONSTRAINT "account_revisions_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "currency_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"currency" text NOT NULL,
	"on_date" date NOT NULL,
	"rate_date" date NOT NULL,
	"rate_e4" bigint NOT NULL,
	"scale" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "currency_rates_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currency_rates_positive_check" CHECK ("rate_e4" > 0 and "scale" > 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "bank" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "mask" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "balance_minor" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "balance_on" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "balance_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
DROP INDEX "accounts_cash_per_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_cash_per_user_idx" ON "accounts" ("household_id","user_id") WHERE "kind" = 'cash' and "currency" = 'BYN';--> statement-breakpoint
CREATE INDEX "account_revisions_account_id_fk_idx" ON "account_revisions" ("household_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_unknown_card_idx" ON "accounts" ("household_id") WHERE "kind" = 'unknown-card';--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_bank_mask_idx" ON "accounts" ("household_id",lower("bank"),"mask","currency") WHERE "mask" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "currency_rates_currency_day_idx" ON "currency_rates" ("currency","on_date");--> statement-breakpoint
ALTER TABLE "account_revisions" ADD CONSTRAINT "account_revisions_account_id_fk" FOREIGN KEY ("household_id","account_id") REFERENCES "accounts"("household_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_mask_check" CHECK ("mask" is null or "mask" ~ '^[0-9]{4}$');--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_balance_source_check" CHECK ("balance_source" in ('manual', 'statement', 'operations'));--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_kind_check", ADD CONSTRAINT "accounts_kind_check" CHECK ("kind" in ('cash', 'card', 'current', 'savings', 'deposit', 'unknown-card'));