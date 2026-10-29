CREATE TABLE "llm_local_models" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"file" text NOT NULL UNIQUE,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"bytes_done" bigint DEFAULT 0 NOT NULL,
	"bytes_total" bigint DEFAULT 0 NOT NULL,
	"error_code" text,
	"updated_at" timestamp with time zone NOT NULL
);
