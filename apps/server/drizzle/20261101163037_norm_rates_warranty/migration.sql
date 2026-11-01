-- T-047, CAL-04: срок гарантии по умолчанию — «в течение двух лет со дня передачи» (ст. 21, п. 1 Закона № 90-З «О защите прав
-- потребителей»; полный текст — legal-base/__fixtures__/pravo-by/H10200090.html, сохранён 2026-10-30). 24 месяца; конца периода нет:
-- значение действует, пока норма не изменится. «Подтверждено разработчиком» в день сверки с текстом (norm-tables/domain/seed-values.ts).
INSERT INTO "norm_rates" ("param", "valid_from", "valid_to", "value", "status", "source_act", "source_path", "source_article", "source_point", "source_url", "confirmed_by_kind", "confirmed_on") VALUES
	('warranty.default-months', '2026-01-01', NULL, 24, 'confirmed', 'H10200090', 'a21/p1', '21', '1', NULL, 'developer', '2026-10-30');
