ALTER TABLE "receipt_items" ADD COLUMN "category_code" text;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD COLUMN "category_id" uuid;--> statement-breakpoint
ALTER TABLE "receipt_items" ADD COLUMN "warranty" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "receipts" ADD COLUMN "confirmed_at" timestamp with time zone;