CREATE TABLE "merchant_aliases" (
	"alias" text PRIMARY KEY,
	"merchant_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merchant_directory" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"category_code" text
);
--> statement-breakpoint
CREATE INDEX "merchant_aliases_trgm_idx" ON "merchant_aliases" USING gin ("alias" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "merchant_aliases" ADD CONSTRAINT "merchant_aliases_merchant_id_merchant_directory_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant_directory"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Руками (T-020): сид справочника контрагентов РБ (CAT-03) — известные сети, операторы связи, АЗС, такси, аптеки,
-- сервисы. Алиасы — ключи очищенного описания (domain/clean-name.ts: верхний регистр, без шума); код категории —
-- встроенная категория (system_categories, модуль categories). Публичные названия организаций, не данные пользователей.
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Евроопт', 'groceries') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['EVROTORG', 'ЕВРОТОРГ', 'ЕВРООПТ', 'EUROOPT', 'EVROOPT']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Санта', 'groceries') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['SANTA', 'САНТА']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Корона', 'groceries') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['KORONA', 'КОРОНА']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Гиппо', 'groceries') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['GIPPO', 'ГИППО']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Белмаркет', 'groceries') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['BELMARKET', 'БЕЛМАРКЕТ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Алми', 'groceries') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['ALMI', 'АЛМИ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Соседи', 'groceries') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['SOSEDI', 'СОСЕДИ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Виталюр', 'groceries') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['VITALUR', 'ВИТАЛЮР']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Простор', 'groceries') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['PROSTORE', 'ПРОСТОР']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Белоруснефть', 'car') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['BELORUSNEFT', 'BELARUSNEFT', 'БЕЛОРУСНЕФТЬ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Лукойл', 'car') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['LUKOIL', 'ЛУКОЙЛ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('А-100', 'car') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['A-100', 'А-100', 'A100']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Газпромнефть', 'car') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['GAZPROMNEFT', 'ГАЗПРОМНЕФТЬ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Яндекс Go', 'taxi') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['YANDEX.GO', 'YANDEX GO', 'YANDEX.TAXI', 'ЯНДЕКС GO']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Uber', 'taxi') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['UBER']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('МТС', 'telecom') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['MTS', 'МТС']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('A1', 'telecom') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['A1', 'А1']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('life:)', 'telecom') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['LIFE', 'ЛАЙФ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Белтелеком', 'telecom') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['BELTELECOM', 'БЕЛТЕЛЕКОМ', 'BYFLY']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('21vek.by', 'electronics') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['21VEK', '21ВЕК', '21VEK.BY']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Электросила', 'electronics') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['ELEKTROSILA', 'ЭЛЕКТРОСИЛА']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Wildberries', 'other') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['WILDBERRIES', 'ВАЙЛДБЕРРИЗ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Ozon', 'other') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['OZON', 'ОЗОН']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('KFC', 'cafes') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['KFC']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('McDonald''s', 'cafes') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['MCDONALDS', 'MCDONALD', 'МАКДОНАЛДС']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Burger King', 'cafes') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['BURGER KING', 'БУРГЕР КИНГ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Додо Пицца', 'cafes') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['DODO PIZZA', 'ДОДО ПИЦЦА']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Белфармация', 'health') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['BELFARMACIYA', 'БЕЛФАРМАЦИЯ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Адель', 'health') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['ADEL', 'АДЕЛЬ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Мила', 'beauty') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['MILA', 'МИЛА']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Остров чистоты', 'household') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['OSTROV CHISTOTY', 'ОСТРОВ ЧИСТОТЫ']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Spotify', 'subscriptions') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['SPOTIFY']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Netflix', 'subscriptions') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['NETFLIX']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Apple', 'subscriptions') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['APPLE.COM', 'APPLE']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Google', 'subscriptions') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['GOOGLE']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Белавиа', 'travel') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['BELAVIA', 'БЕЛАВИА']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Белорусская железная дорога', 'transport') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['BCH', 'БЖД', 'RW.BY']) AS a;--> statement-breakpoint
WITH m AS (INSERT INTO "merchant_directory" ("name", "category_code") VALUES ('Минсктранс', 'transport') RETURNING "id")
INSERT INTO "merchant_aliases" ("alias", "merchant_id") SELECT a, m."id" FROM m, unnest(ARRAY['MINSKTRANS', 'МИНСКТРАНС']) AS a;
