CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"currency" text NOT NULL,
	"on_date" date NOT NULL,
	"rate_date" date NOT NULL,
	"rate_e4" bigint NOT NULL,
	"scale" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "fx_rates_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "fx_rates_positive_check" CHECK ("rate_e4" > 0 and "scale" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_currency_day_idx" ON "fx_rates" ("currency","on_date");