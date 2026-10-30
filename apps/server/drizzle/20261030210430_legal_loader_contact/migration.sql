ALTER TABLE "system_state" ADD COLUMN "loader_contact" text;--> statement-breakpoint
ALTER TABLE "legal_loader_state" ADD COLUMN "stopped_on" date;--> statement-breakpoint
ALTER TABLE "legal_loader_state" ADD COLUMN "cycle_day" date;--> statement-breakpoint
ALTER TABLE "legal_loader_state" DROP COLUMN "stopped_until";--> statement-breakpoint
ALTER TABLE "legal_loader_state" DROP COLUMN "cycle_started_at";