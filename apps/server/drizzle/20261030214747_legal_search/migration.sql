CREATE TABLE "legal_act_aliases" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"act_id" uuid NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_embedding_models" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"version" text NOT NULL,
	"dimensions" integer NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_fragment_embeddings" (
	"version_id" uuid PRIMARY KEY,
	"model_id" uuid NOT NULL,
	"embedding" halfvec(1024) NOT NULL,
	"embedded_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "legal_fragment_versions" ADD COLUMN "search_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('russian', translate(lower(search_path || ' ' || body), 'ё', 'е'))) STORED;--> statement-breakpoint
CREATE UNIQUE INDEX "legal_act_aliases_alias_idx" ON "legal_act_aliases" ("alias","act_id");--> statement-breakpoint
CREATE INDEX "legal_fragment_embeddings_model_idx" ON "legal_fragment_embeddings" ("model_id");--> statement-breakpoint
ALTER TABLE "legal_act_aliases" ADD CONSTRAINT "legal_act_aliases_act_id_legal_acts_id_fkey" FOREIGN KEY ("act_id") REFERENCES "legal_acts"("id");--> statement-breakpoint
ALTER TABLE "legal_fragment_embeddings" ADD CONSTRAINT "legal_fragment_embeddings_XPFqyekSp4gD_fkey" FOREIGN KEY ("version_id") REFERENCES "legal_fragment_versions"("id");--> statement-breakpoint
ALTER TABLE "legal_fragment_embeddings" ADD CONSTRAINT "legal_fragment_embeddings_PHMuFBDYrjHO_fkey" FOREIGN KEY ("model_id") REFERENCES "legal_embedding_models"("id");--> statement-breakpoint
-- Полнотекстовый индекс по действующим версиям (LAW-21, ADR-0007): только current, чтобы индекс не рос с историей.
CREATE INDEX "legal_fragment_versions_tsv_idx" ON "legal_fragment_versions" USING gin ("search_tsv") WHERE "is_current";--> statement-breakpoint
-- Первая модель эмбеддингов — bge-m3 (ADR-0011); фиксированный id нужен частичному HNSW-индексу (частичный индекс на модель).
INSERT INTO "legal_embedding_models" ("id", "name", "version", "dimensions", "active")
VALUES ('019e0000-0000-7000-8000-000000000001', 'bge-m3', '1', 1024, true);--> statement-breakpoint
CREATE INDEX "legal_fragment_embeddings_hnsw_idx" ON "legal_fragment_embeddings" USING hnsw ("embedding" halfvec_cosine_ops) WITH (m = 16, ef_construction = 64) WHERE "model_id" = '019e0000-0000-7000-8000-000000000001';
