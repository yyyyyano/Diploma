CREATE TABLE "background_job_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"kind" text NOT NULL,
	"schedule_key" text,
	"status" text NOT NULL,
	"progress" smallint,
	"watermark" date,
	"error_code" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "background_job_run_status_check" CHECK ("status" in ('running', 'completed', 'failed', 'dropped')),
	CONSTRAINT "background_job_run_progress_check" CHECK ("progress" between 0 and 100)
);
--> statement-breakpoint
CREATE INDEX "background_job_run_started_at_idx" ON "background_job_run" ("started_at");--> statement-breakpoint
CREATE INDEX "background_job_run_schedule_key_watermark_idx" ON "background_job_run" ("schedule_key","watermark") WHERE "schedule_key" is not null;