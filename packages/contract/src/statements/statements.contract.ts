// Импорт выписок (STMT-03, STMT-04, STMT-10, STMT-11, NFR-21): загрузка уже сделана процедурой files.upload; здесь —
// разбор и предпросмотр (черновик импорта: числа считает сервер), «Импортировать», «Исправить колонки», «Отмена»,
// откат с подтверждением и вкладка выписок. Ход разбора — сигналы events.stream по сущности `statement-import`.
// Суммы — Money (копейки + валюта), строки предпросмотра: сырое описание → контрагент → категория.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { UndoToken, DecisionId } from "../actions/actions.contract.ts";
import { CategoryRef } from "../categories/categories.contract.ts";
import { LocalDate, Money } from "../common.ts";
import { pickErrors } from "../errors.ts";

export const StatementImportId = z.uuid().brand<"StatementImportId">();
export type StatementImportId = z.infer<typeof StatementImportId>;

/** Статус импорта: разбор → предпросмотр (`ready`) → импорт → откат; `failed` — файл не прочитан. */
export const ImportStatus = z.enum([
  "parsing",
  "ready",
  "importing",
  "imported",
  "rolled-back",
  "failed",
]);
export type ImportStatus = z.infer<typeof ImportStatus>;

/** Роль колонки таблицы выписки (окно «Исправить колонки»). */
export const ColumnRole = z.enum([
  "date",
  "time",
  "description",
  "amount",
  "debit",
  "credit",
  "currency",
  "operationAmount",
  "operationCurrency",
  "balance",
  "operationId",
  "ignore",
]);
export type ColumnRole = z.infer<typeof ColumnRole>;

/** Как найдены колонки: запомненный формат, словарь заголовков или модель (STMT-05). */
export const ParseMethod = z.enum(["remembered", "detected", "model"]);

export const BalanceStatus = z.enum(["ok", "mismatch", "unknown"]);

export const ImportSummary = z.strictObject({
  id: StatementImportId,
  fileId: z.uuid(),
  status: ImportStatus,
  bank: z.string().nullable(),
  /** Последние 4 цифры карты или счёта. */
  mask: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  currency: z.string().nullable(),
  period: z.strictObject({ from: LocalDate.schema, to: LocalDate.schema }).nullable(),
  /** Итоги STMT-04, считает код: найдено, новых, дублей (уже были загружены), спорных переводов, ошибок. */
  found: z.int().nonnegative(),
  newCount: z.int().nonnegative(),
  duplicates: z.int().nonnegative(),
  doubtful: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
  method: ParseMethod.nullable(),
  /** Формат банка изменился — колонки определены заново (STMT-05). */
  formatChanged: z.boolean(),
  /** Сверка цепочки остатков (STMT-04 шаг 3): расхождение — «проверьте». */
  balance: z
    .strictObject({ status: BalanceStatus, difference: Money.schema.nullable() })
    .nullable(),
  warnings: z.array(z.string().max(64)),
  /** Код ошибки, если файл не прочитан. */
  errorCode: z.string().nullable(),
  accountId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  importedAt: z.iso.datetime().nullable(),
});
export type ImportSummary = z.infer<typeof ImportSummary>;

/** Тип операции в предпросмотре (STMT-08). */
export const PreviewKind = z.enum(["expense", "income", "refund", "transfer"]);

export const PreviewRow = z.strictObject({
  date: LocalDate.schema,
  time: z.string().nullable(),
  /** Сумма со знаком счёта: расход «−», приход «+». */
  amount: Money.schema,
  /** Сырое описание из файла (STMT-06: хранится всегда). */
  description: z.string(),
  merchantName: z.string().nullable(),
  category: CategoryRef.nullable(),
  kind: PreviewKind,
  duplicate: z.boolean(),
  doubtful: z.boolean(),
});

/** Образец таблицы для окна «Исправить колонки»: шапка, первые строки и текущие роли. */
export const ColumnsSample = z.strictObject({
  header: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  roles: z.array(ColumnRole),
});

export const ImportDetail = z.strictObject({
  summary: ImportSummary,
  /** Первые строки предпросмотра (число — настройка); остальные видны после импорта в «Операциях». */
  rows: z.array(PreviewRow),
  columns: ColumnsSample.nullable(),
});

export type ImportDetail = z.infer<typeof ImportDetail>;

export const StatementImportRef = z.strictObject({ id: StatementImportId });

export const statementsContract = {
  /** Начать разбор загруженного файла-выписки (files.upload, вид `statement`): ответ сразу, дальше — сигналы. */
  start: oc
    .route({ method: "POST", path: "/statements/imports" })
    .input(z.strictObject({ fileId: z.uuid() }))
    .output(z.strictObject({ id: StatementImportId }))
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND")),
  /** Вкладка выписок: импорты, новые сверху. */
  list: oc
    .route({ method: "GET", path: "/statements/imports" })
    .output(z.strictObject({ items: z.array(ImportSummary) }))
    .errors(pickErrors("UNAUTHORIZED")),
  /** Предпросмотр импорта: итоги, первые строки, образец колонок. */
  get: oc
    .route({ method: "GET", path: "/statements/imports/{id}" })
    .input(StatementImportRef)
    .output(ImportDetail)
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND")),
  /** «Импортировать N»: одна транзакция; спорные переводы — один вопрос «Да/Нет» (`decisionId`). */
  confirm: oc
    .route({ method: "POST", path: "/statements/imports/{id}/confirm" })
    .input(StatementImportRef)
    .output(
      z.strictObject({
        imported: z.int().nonnegative(),
        duplicates: z.int().nonnegative(),
        undoToken: UndoToken,
        decisionId: DecisionId.nullable(),
      }),
    )
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT")),
  /** «Исправить колонки»: роли каждой колонки, повторный разбор без модели. */
  fixColumns: oc
    .route({ method: "POST", path: "/statements/imports/{id}/columns" })
    .input(
      z.strictObject({
        id: StatementImportId,
        columns: z
          .array(z.strictObject({ index: z.int().min(0).max(63), role: ColumnRole }))
          .max(64),
      }),
    )
    .output(z.strictObject({ id: StatementImportId }))
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT")),
  /** «Отмена»: черновик и загруженный файл удаляются. */
  cancel: oc
    .route({ method: "POST", path: "/statements/imports/{id}/cancel" })
    .input(StatementImportRef)
    .output(z.strictObject({ id: StatementImportId }))
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT")),
  /** Для подтверждения отката: сколько операций и сколько из них правили вручную (они тоже удаляются). */
  rollbackInfo: oc
    .route({ method: "GET", path: "/statements/imports/{id}/rollback" })
    .input(StatementImportRef)
    .output(z.strictObject({ transactions: z.int().nonnegative(), edited: z.int().nonnegative() }))
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT")),
  /** «Откатить импорт» — после подтверждения человека. */
  rollback: oc
    .route({ method: "POST", path: "/statements/imports/{id}/rollback" })
    .input(StatementImportRef)
    .output(z.strictObject({ status: z.enum(["undone", "already-undone"]) }))
    .errors(pickErrors("VALIDATION", "UNAUTHORIZED", "NOT_FOUND", "CONFLICT")),
};
