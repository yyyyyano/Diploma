-- T-045, TAX-03: ставки ст. 214 НК (подоходный налог, ИП) и ст. 381² НК (НПД) найдены в полном тексте НК, сохранённом 2026-11-01
-- (legal-base/__fixtures__/pravo-by/Hk0900071.html): значения, которые ещё ждут подтверждения, становятся «подтверждено разработчиком».
-- Только строки `pending` с тем же значением и только если на этот период нет подтверждённого: подтверждённое администратором и правки не трогаем.
-- Источник уточняется до пункта (сверка LAW-33 ищет число в пункте); у НПД статья 381², а не 380 — в ст. 380 ставок нет.
UPDATE "norm_rates" AS r SET
	"status" = 'confirmed',
	"confirmed_by_kind" = 'developer',
	"confirmed_on" = '2026-11-01',
	"source_act" = 'Hk0900071',
	"source_path" = v.path,
	"source_article" = v.article,
	"source_point" = v.point,
	"source_url" = NULL
FROM (VALUES
	('ndfl.rate.base', 1300, 'a214/p1.1', '214', '1.1'),
	('ndfl.rate.high', 2500, 'a214/p1.2', '214', '1.2'),
	('ndfl.rate.high-from', 35000000, 'a214/p1.2', '214', '1.2'),
	('ndfl.rate.top', 3000, 'a214/p1.3', '214', '1.3'),
	('ndfl.rate.top-from', 60000000, 'a214/p1.3', '214', '1.3'),
	('ip.rate.base', 2000, 'a214/p3', '214', '3'),
	('ip.rate.high', 3000, 'a214/p3', '214', '3'),
	('ip.rate.high-from', 50000000, 'a214/p3', '214', '3'),
	('npd.rate.base', 1000, 'a381.2', '381²', '1'),
	('npd.rate.high', 2000, 'a381.2', '381²', '1'),
	('npd.rate.high-from', 6000000, 'a381.2', '381²', '1')
) AS v("param", "value", "path", "article", "point")
WHERE r."param" = v."param" AND r."value" = v."value" AND r."valid_from" = '2026-01-01' AND r."status" = 'pending'
	AND NOT EXISTS (
		SELECT 1 FROM "norm_rates" c WHERE c."param" = r."param" AND c."valid_from" = r."valid_from" AND c."status" = 'confirmed'
	);
--> statement-breakpoint
-- TAX-04: взнос работника в ФСЗН (1 %) нужен оценке «на руки / 0,86»; нормы о нём в сохранённых страницах нет — ждёт «Подтвердить».
INSERT INTO "norm_rates" ("param", "valid_from", "valid_to", "value", "status", "source_article") VALUES
	('fszn.employee-rate', '2026-01-01', '2026-12-31', 100, 'pending', 'ФСЗН');
