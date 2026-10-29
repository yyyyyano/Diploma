CREATE TABLE "transaction_revisions" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"action" text NOT NULL,
	"channel" text NOT NULL,
	"before" jsonb,
	"version_after" integer,
	"fields" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "transaction_revisions_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "transaction_revisions_action_check" CHECK ("action" in ('created', 'updated', 'deleted', 'restored')),
	CONSTRAINT "transaction_revisions_channel_check" CHECK ("channel" in ('web', 'telegram', 'system'))
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"account_id" uuid NOT NULL,
	"type" text NOT NULL,
	"direction" text NOT NULL,
	"occurred_on" date NOT NULL,
	"occurred_time" time(0),
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"amount_byn_minor" bigint,
	"fx_rate_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"merchant_name" text,
	"merchant_key" text,
	"note" text,
	"category_code" text,
	"category_id" uuid,
	"category_source" text,
	"source" text NOT NULL,
	"visibility" text DEFAULT 'personal' NOT NULL,
	"transfer_pair_id" uuid,
	"refund_of_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "transactions_pkey" PRIMARY KEY("household_id","id"),
	CONSTRAINT "transactions_type_check" CHECK ("type" in ('expense', 'income', 'transfer', 'refund')),
	CONSTRAINT "transactions_direction_check" CHECK ("direction" in ('in', 'out') and ("type" = 'transfer' or "direction" = case "type" when 'expense' then 'out' else 'in' end)),
	CONSTRAINT "transactions_amount_check" CHECK ("amount_minor" > 0),
	CONSTRAINT "transactions_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "transactions_category_check" CHECK (case when "type" = 'transfer' then num_nonnulls("category_code", "category_id") = 0 else num_nonnulls("category_code", "category_id") = 1 and "category_source" is not null end),
	CONSTRAINT "transactions_category_source_check" CHECK ("category_source" is null or "category_source" in ('user', 'user-rule', 'merchant', 'keyword', 'mcc', 'model', 'cache', 'fallback')),
	CONSTRAINT "transactions_source_check" CHECK ("source" in ('manual', 'assistant', 'statement', 'receipt')),
	CONSTRAINT "transactions_visibility_check" CHECK ("visibility" in ('personal', 'shared'))
);
--> statement-breakpoint
CREATE INDEX "transaction_revisions_transaction_idx" ON "transaction_revisions" ("household_id","transaction_id","created_at");--> statement-breakpoint
CREATE INDEX "transaction_revisions_batch_idx" ON "transaction_revisions" ("household_id","batch_id");--> statement-breakpoint
CREATE INDEX "transactions_date_idx" ON "transactions" ("household_id","occurred_on" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "transactions_merchant_key_idx" ON "transactions" ("household_id","merchant_key");--> statement-breakpoint
CREATE INDEX "transactions_rate_missing_idx" ON "transactions" ("household_id","id") WHERE "amount_byn_minor" is null;--> statement-breakpoint
-- Составные FK написаны руками: Drizzle-схема transactions не видит чужие таблицы (schema-only-in-infrastructure).
-- Счёт с операциями не удаляется (RESTRICT → CONFLICT у accounts); своя категория не удаляется, только скрывается.
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_fk" FOREIGN KEY ("household_id","account_id") REFERENCES "accounts"("household_id","id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "transactions_account_id_fk_idx" ON "transactions" ("household_id","account_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_fk" FOREIGN KEY ("household_id","category_id") REFERENCES "categories"("household_id","id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX "transactions_category_id_fk_idx" ON "transactions" ("household_id","category_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_code_fk" FOREIGN KEY ("category_code") REFERENCES "system_categories"("code");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_pair_id_fk" FOREIGN KEY ("household_id","transfer_pair_id") REFERENCES "transactions"("household_id","id") ON DELETE SET NULL ("transfer_pair_id");--> statement-breakpoint
CREATE INDEX "transactions_transfer_pair_id_fk_idx" ON "transactions" ("household_id","transfer_pair_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refund_of_id_fk" FOREIGN KEY ("household_id","refund_of_id") REFERENCES "transactions"("household_id","id") ON DELETE SET NULL ("refund_of_id");--> statement-breakpoint
CREATE INDEX "transactions_refund_of_id_fk_idx" ON "transactions" ("household_id","refund_of_id");
