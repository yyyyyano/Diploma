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

/** Окно пары перевода, дней (STMT-08): «списание тут — зачисление там» на ту же сумму. */
export const STATEMENTS_TRANSFER_WINDOW_DAYS = defineSetting({
  key: "statements.transfer-window-days",
  schema: z.int().min(0).max(14),
  default: 3,
});

/** Окно покупки возврата, дней (STMT-08): возврат ищет покупку у того же контрагента не старше этого. */
export const STATEMENTS_REFUND_WINDOW_DAYS = defineSetting({
  key: "statements.refund-window-days",
  schema: z.int().min(1).max(365),
  default: 60,
});

/** Через сколько дней брошенный черновик импорта удаляется (ночной обход). */
export const STATEMENTS_DRAFT_TTL_DAYS = defineSetting({
  key: "statements.draft-ttl-days",
  schema: z.int().min(1).max(90),
  default: 7,
});

/** Строк предпросмотра в ответе сайту (первые; остальные — после импорта в «Операциях»). */
export const STATEMENTS_PREVIEW_ROWS = defineSetting({
  key: "statements.preview-rows",
  schema: z.int().min(3).max(50),
  default: 5,
});
