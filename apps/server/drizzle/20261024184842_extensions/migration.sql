-- Расширения PostgreSQL (ADR-0007), ручная миграция (drizzle-kit generate --custom): vector — эмбеддинги
-- фрагментов законов (halfvec, HNSW), pg_trgm — нечёткое сравнение названий магазинов и контрагентов.
-- Создаёт их владелец базы из compose.yaml (суперпользователь). Их функции в public проверка схемы не считает
-- своими: они принадлежат расширениям.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
