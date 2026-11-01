-- T-048, CAL-02: сроки уплаты налогов граждан и подачи декларации — из полного текста НК (Особенная часть), сохранённого 2026-11-01
-- (legal-base/__fixtures__/pravo-by/Hk0900071.html). Конца периода нет: срок действует, пока норма не изменится. «Подтверждено разработчиком»
-- в день сверки с текстом (norm-tables/domain/seed-values.ts, seed-values.test.ts сверяет числа с текстом пунктов).
--   233 п. 5 · 244 п. 8.1 · 307⁸ п. 2 — «ежегодно не позднее 15 ноября года, следующего за истекшим налоговым периодом» (1115 = 15.11);
--   381⁷ п. 2 — «не позднее 22-го числа месяца, следующего за истекшим налоговым периодом» (число месяца 22);
--   222 п. 1 — «не позднее 31 марта года, следующего за истекшим налоговым периодом» (331 = 31.03).
INSERT INTO "norm_rates" ("param", "valid_from", "valid_to", "value", "status", "source_act", "source_path", "source_article", "source_point", "source_url", "confirmed_by_kind", "confirmed_on") VALUES
	('deadline.property-tax', '2026-01-01', NULL, 1115, 'confirmed', 'Hk0900071', 'a233/p5', '233', '5', NULL, 'developer', '2026-11-01'),
	('deadline.land-tax', '2026-01-01', NULL, 1115, 'confirmed', 'Hk0900071', 'a244/p8.1', '244', '8.1', NULL, 'developer', '2026-11-01'),
	('deadline.transport-tax', '2026-01-01', NULL, 1115, 'confirmed', 'Hk0900071', 'a307.8/p2', '307⁸', '2', NULL, 'developer', '2026-11-01'),
	('deadline.npd-payment', '2026-01-01', NULL, 22, 'confirmed', 'Hk0900071', 'a381.7', '381⁷', '2', NULL, 'developer', '2026-11-01'),
	('deadline.declaration', '2026-01-01', NULL, 331, 'confirmed', 'Hk0900071', 'a222', '222', '1', NULL, 'developer', '2026-11-01');
