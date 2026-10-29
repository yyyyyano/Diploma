CREATE TABLE "llm_preferences" (
	"id" uuid DEFAULT uuidv7(),
	"household_id" uuid,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model_id" text NOT NULL,
	CONSTRAINT "llm_preferences_pkey" PRIMARY KEY("household_id","id")
);
--> statement-breakpoint
CREATE TABLE "llm_task_chains" (
	"task" text,
	"model_id" text,
	"position" integer NOT NULL,
	CONSTRAINT "llm_task_chains_pkey" PRIMARY KEY("task","model_id")
);
--> statement-breakpoint
ALTER TABLE "llm_models" ADD COLUMN "rpm" integer;--> statement-breakpoint
ALTER TABLE "llm_models" ADD COLUMN "tpm" integer;--> statement-breakpoint
ALTER TABLE "llm_models" ADD COLUMN "rpd" integer;--> statement-breakpoint
ALTER TABLE "llm_models" ADD COLUMN "tpd" integer;--> statement-breakpoint
ALTER TABLE "llm_models" ADD COLUMN "user_selectable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "llm_preferences_user_idx" ON "llm_preferences" ("household_id","user_id");
--> statement-breakpoint
-- Руками (T-023): реестр моделей по умолчанию — Groq → Z.ai → локальная (LLM-02). Идентификаторы сверены с
-- GET /models обоих провайдеров на 2026-10-29. Лимиты Groq: rpd и tpm — из заголовков x-ratelimit-* живого ответа,
-- rpm и tpd — из таблицы лимитов Groq (console.groq.com/docs/rate-limits); у Z.ai лимиты бесплатных моделей не
-- опубликованы — null (работают заголовки и retry-after). Цены 0 (NFR-02): прайс правится в админке (ADM-21).
-- Контекст — нижняя граница, не обещание провайдера: в логике шлюза он не участвует.
INSERT INTO "llm_models" ("id", "provider", "model_id", "cloud", "capabilities", "priority", "enabled", "context_tokens", "rpm", "tpm", "rpd", "tpd", "user_selectable") VALUES
  ('groq/openai/gpt-oss-120b', 'groq', 'openai/gpt-oss-120b', true, ARRAY['text', 'tools', 'structured'], 10, true, 131072, 30, 8000, 1000, 200000, true),
  ('groq/qwen/qwen3.8-27b', 'groq', 'qwen/qwen3.8-27b', true, ARRAY['text', 'images', 'structured'], 11, true, 32768, NULL, 8000, 1000, NULL, false),
  ('groq/whisper-large-v3-turbo', 'groq', 'whisper-large-v3-turbo', true, ARRAY['speech'], 12, true, 0, 20, NULL, 2000, NULL, false),
  ('zai/glm-4.7-flash', 'zai', 'glm-4.7-flash', true, ARRAY['text', 'tools', 'structured'], 20, true, 131072, NULL, NULL, NULL, NULL, true),
  ('zai/glm-4.6v-flash', 'zai', 'glm-4.6v-flash', true, ARRAY['text', 'images', 'structured'], 21, true, 32768, NULL, NULL, NULL, NULL, false),
  ('llama/qwen3.5-4b', 'llama', 'qwen3.5-4b', false, ARRAY['text', 'tools', 'images', 'structured'], 90, true, 32768, NULL, NULL, NULL, NULL, true),
  ('llama/bge-m3', 'llama', 'bge-m3', false, ARRAY['embeddings'], 50, true, 8192, NULL, NULL, NULL, NULL, false);
--> statement-breakpoint
-- Цепочки по задачам: первым облачный Groq, затем Z.ai, последней локальная; задача без модели нужной возможности
-- получает цепочку из тех, что есть (чеки — модели с изображениями, голос и векторы — свои).
INSERT INTO "llm_task_chains" ("task", "model_id", "position") VALUES
  ('chat', 'groq/openai/gpt-oss-120b', 1), ('chat', 'zai/glm-4.7-flash', 2), ('chat', 'llama/qwen3.5-4b', 3),
  ('statement.columns', 'groq/openai/gpt-oss-120b', 1), ('statement.columns', 'zai/glm-4.7-flash', 2), ('statement.columns', 'llama/qwen3.5-4b', 3),
  ('classify.category', 'groq/openai/gpt-oss-120b', 1), ('classify.category', 'zai/glm-4.7-flash', 2), ('classify.category', 'llama/qwen3.5-4b', 3),
  ('classify.off-topic', 'groq/openai/gpt-oss-120b', 1), ('classify.off-topic', 'zai/glm-4.7-flash', 2), ('classify.off-topic', 'llama/qwen3.5-4b', 3),
  ('law.topic', 'groq/openai/gpt-oss-120b', 1), ('law.topic', 'zai/glm-4.7-flash', 2), ('law.topic', 'llama/qwen3.5-4b', 3),
  ('receipt.extract', 'groq/qwen/qwen3.8-27b', 1), ('receipt.extract', 'zai/glm-4.6v-flash', 2), ('receipt.extract', 'llama/qwen3.5-4b', 3),
  ('embed', 'llama/bge-m3', 1),
  ('transcribe', 'groq/whisper-large-v3-turbo', 1);
--> statement-breakpoint
-- Тестовая модель (T-010) в боевой базе выключена: чат отвечает настоящими моделями. Тесты и стенд e2e включают её
-- фикстурой шаблонной базы (platform/db/__fixtures__/test-template.ts).
UPDATE "llm_models" SET "enabled" = false WHERE "id" = 'test/scripted';
--> statement-breakpoint
-- Версия текста облачного согласия поднята до 2026-10-29 (сканы выписок, условия бесплатных тарифов): согласия по
-- прежнему тексту больше не действуют (источник согласия сверяет версию), режим «облачный» для админки — тоже.
UPDATE "privacy_modes" SET "cloud" = false;
