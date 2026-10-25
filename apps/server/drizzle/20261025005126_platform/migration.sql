CREATE TABLE "rate_limits" (
	"rule" text,
	"key_hash" bytea,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_pkey" PRIMARY KEY("rule","key_hash")
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"name" text PRIMARY KEY,
	"iv" bytea NOT NULL,
	"tag" bytea NOT NULL,
	"ciphertext" bytea NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
