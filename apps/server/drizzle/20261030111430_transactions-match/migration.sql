ALTER TABLE "transactions" ADD COLUMN "match_declined" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "merged_receipt" jsonb;