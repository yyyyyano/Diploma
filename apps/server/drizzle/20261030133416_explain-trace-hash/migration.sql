ALTER TABLE "explanations" ADD COLUMN "trace_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "explanations_trace_hash_idx" ON "explanations" ("household_id","trace_hash");