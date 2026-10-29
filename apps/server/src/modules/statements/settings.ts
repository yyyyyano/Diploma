// Настройки разбора выписок (SEC-03, STMT-04): срок и память изолированного потока чтения, размер фрагмента для модели.
import { z } from "zod";
import { defineSetting } from "../../platform/settings/settings.ts";

/** Срок чтения файла в потоке, мс: дольше — поток прерывается (зависший PDF, «бомба»). */
export const STATEMENTS_PARSE_TIMEOUT_MS = defineSetting({
  key: "statements.parse-timeout-ms",
  schema: z.int().min(1_000).max(600_000),
  default: 60_000,
});

/** Предел памяти потока чтения, МБ: больше — поток падает, процесс жив. */
export const STATEMENTS_PARSE_MEMORY_MB = defineSetting({
  key: "statements.parse-memory-mb",
  schema: z.int().min(64).max(4_096),
  default: 512,
});

/** Строк данных во фрагменте, который уходит модели для определения колонок (STMT-04 шаг 2): маленький, не вся выписка. */
export const STATEMENTS_COLUMNS_SAMPLE_ROWS = defineSetting({
  key: "statements.columns-sample-rows",
  schema: z.int().min(3).max(30),
  default: 8,
});
