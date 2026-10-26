CREATE TABLE "llm_trace_deletions" (
	"user_id" uuid PRIMARY KEY,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_attempt_at" timestamp with time zone
);
