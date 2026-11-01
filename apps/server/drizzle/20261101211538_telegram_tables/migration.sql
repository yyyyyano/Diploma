CREATE TABLE "telegram_bot" (
	"id" smallint PRIMARY KEY DEFAULT 1,
	"username" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "telegram_bot_single_row_check" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "telegram_link_codes" (
	"code_hash" text PRIMARY KEY,
	"user_id" uuid NOT NULL,
	"household_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_links" (
	"user_id" uuid PRIMARY KEY,
	"household_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"username" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_receipt_cards" (
	"receipt_id" uuid PRIMARY KEY,
	"household_id" uuid NOT NULL,
	"chat_id" bigint NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "telegram_link_codes_user_idx" ON "telegram_link_codes" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_links_chat_id_idx" ON "telegram_links" ("chat_id");--> statement-breakpoint
CREATE INDEX "telegram_receipt_cards_household_idx" ON "telegram_receipt_cards" ("household_id");