-- Счётчик применений для теста pg_advisory_lock (migrate.int.test.ts): тело миграции пишет строку; два
-- параллельных runMigrations должны оставить ровно одну.
CREATE TABLE IF NOT EXISTS fx_migration_runs (run integer NOT NULL);
--> statement-breakpoint
INSERT INTO fx_migration_runs VALUES (1);
