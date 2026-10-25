CREATE TABLE "llm_models" (
	"id" text PRIMARY KEY,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"cloud" boolean NOT NULL,
	"capabilities" text[] NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"context_tokens" integer NOT NULL,
	"input_micros_per_million" integer DEFAULT 0 NOT NULL,
	"output_micros_per_million" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_usage" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"task" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"ms" integer NOT NULL,
	"cost_micros" bigint NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "llm_usage_created_at_idx" ON "llm_usage" ("created_at");--> statement-breakpoint
-- Руками (T-010): тестовый провайдер — настоящий адаптер реестра (ARCHITECTURE §8.1), локальный и бесплатный; пока
-- облачных и локальных моделей нет (T-023, T-024), он отвечает в чате по сценарию. Выключается в админке (T-023).
INSERT INTO "llm_models" ("id", "provider", "model_id", "cloud", "capabilities", "priority", "context_tokens")
VALUES ('test/scripted', 'test', 'scripted', false, ARRAY['text', 'tools', 'structured', 'speech', 'embeddings'], 1000, 32768);
