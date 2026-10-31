CREATE TABLE "norm_rates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"param" text NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"value" bigint NOT NULL,
	"status" text NOT NULL,
	"source_act" text,
	"source_path" text,
	"source_article" text,
	"source_point" text,
	"source_url" text,
	"source_version_id" uuid,
	"confirmed_by_kind" text,
	"confirmed_on" date,
	"drift_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "norm_rates_status_check" CHECK ("status" in ('pending','confirmed','superseded','rejected')),
	CONSTRAINT "norm_rates_value_check" CHECK ("value" >= 0),
	CONSTRAINT "norm_rates_period_check" CHECK ("valid_to" is null or "valid_to" >= "valid_from"),
	CONSTRAINT "norm_rates_confirmed_by_check" CHECK ("confirmed_by_kind" is null or "confirmed_by_kind" in ('developer','admin'))
);
--> statement-breakpoint
CREATE INDEX "norm_rates_param_idx" ON "norm_rates" ("param","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "norm_rates_confirmed_idx" ON "norm_rates" ("param","valid_from") WHERE "status" = 'confirmed';--> statement-breakpoint
CREATE UNIQUE INDEX "norm_rates_pending_idx" ON "norm_rates" ("param","valid_from") WHERE "status" = 'pending';
--> statement-breakpoint
-- TAX-03: начальные значения — умолчания кода (norm-tables/domain/seed-values.ts); тест сверяет их с таблицей, а подтверждённые — с текстом НК из фикстуры.
INSERT INTO "norm_rates" ("param", "valid_from", "valid_to", "value", "status", "source_act", "source_path", "source_article", "source_point", "source_url", "confirmed_by_kind", "confirmed_on") VALUES
	('ndfl.std-deduction.base', '2026-01-01', '2026-12-31', 21600, 'confirmed', 'Hk0900071', 'a209/p1.1', '209', '1.1', NULL, 'developer', '2026-10-30'),
	('ndfl.std-deduction.base-income-limit', '2026-01-01', '2026-12-31', 130800, 'confirmed', 'Hk0900071', 'a209/p1.1', '209', '1.1', NULL, 'developer', '2026-10-30'),
	('ndfl.std-deduction.child', '2026-01-01', '2026-12-31', 6300, 'confirmed', 'Hk0900071', 'a209/p1.2', '209', '1.2', NULL, 'developer', '2026-10-30'),
	('ndfl.std-deduction.child-increased', '2026-01-01', '2026-12-31', 12000, 'confirmed', 'Hk0900071', 'a209/p1.2', '209', '1.2', NULL, 'developer', '2026-10-30'),
	('ndfl.std-deduction.disabled', '2026-01-01', '2026-12-31', 30600, 'confirmed', 'Hk0900071', 'a209/p1.3', '209', '1.3', NULL, 'developer', '2026-10-30'),
	('ndfl.std-deduction.young-specialist', '2026-01-01', '2026-12-31', 86000, 'confirmed', 'Hk0900071', 'a209/p1.4', '209', '1.4', NULL, 'developer', '2026-10-30'),
	('ndfl.rate.base', '2026-01-01', '2026-12-31', 1300, 'pending', 'Hk0900071', 'a214', '214', NULL, NULL, NULL, NULL),
	('ndfl.rate.high', '2026-01-01', '2026-12-31', 2500, 'pending', 'Hk0900071', 'a214', '214', NULL, NULL, NULL, NULL),
	('ndfl.rate.high-from', '2026-01-01', '2026-12-31', 35000000, 'pending', 'Hk0900071', 'a214', '214', NULL, NULL, NULL, NULL),
	('ndfl.rate.top', '2026-01-01', '2026-12-31', 3000, 'pending', 'Hk0900071', 'a214', '214', NULL, NULL, NULL, NULL),
	('ndfl.rate.top-from', '2026-01-01', '2026-12-31', 60000000, 'pending', 'Hk0900071', 'a214', '214', NULL, NULL, NULL, NULL),
	('ip.rate.base', '2026-01-01', '2026-12-31', 2000, 'pending', 'Hk0900071', 'a214', '214', NULL, NULL, NULL, NULL),
	('ip.rate.high', '2026-01-01', '2026-12-31', 3000, 'pending', 'Hk0900071', 'a214', '214', NULL, NULL, NULL, NULL),
	('ip.rate.high-from', '2026-01-01', '2026-12-31', 50000000, 'pending', 'Hk0900071', 'a214', '214', NULL, NULL, NULL, NULL),
	('npd.rate.base', '2026-01-01', '2026-12-31', 1000, 'pending', 'Hk0900071', 'a380', '380', NULL, NULL, NULL, NULL),
	('npd.rate.high', '2026-01-01', '2026-12-31', 2000, 'pending', 'Hk0900071', 'a380', '380', NULL, NULL, NULL, NULL),
	('npd.rate.high-from', '2026-01-01', '2026-12-31', 6000000, 'pending', 'Hk0900071', 'a380', '380', NULL, NULL, NULL, NULL),
	('pdn.limit.default', '2026-01-01', '2026-12-31', 4000, 'pending', NULL, NULL, 'ПДН', NULL, 'https://www.nbrb.by/finsector/financialstability/macroprudentialregulation/instrumenty-ogranicheniya-dolgovoj-nagruzki-naseleniya', NULL, NULL),
	('pdn.limit.domestic-goods', '2026-01-01', '2026-12-31', 5000, 'pending', NULL, NULL, 'ПДН', NULL, 'https://www.nbrb.by/finsector/financialstability/macroprudentialregulation/instrumenty-ogranicheniya-dolgovoj-nagruzki-naseleniya', NULL, NULL);
