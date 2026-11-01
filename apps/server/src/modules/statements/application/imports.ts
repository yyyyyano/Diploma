// Импорт выписки в учёт (STMT-03, STMT-04, STMT-10, STMT-11, NFR-21, P5): загрузка → черновик (задача parse в worker, прогресс
// через realtime) → предпросмотр → «Импортировать» одной транзакцией (счёт по банку + маске + валюте, операции, остаток
// с датой, запомненный формат, запись в журнал actions, событие, одно уведомление) или «Исправить колонки» (повторный
// разбор без модели) или «Отмена». Откат — обработчик undo в actions: все операции импорта (правленные вручную тоже)
// удаляются, остаток возвращается. Модель и курсы — только в задаче разбора, до транзакции.
import { LocalDate, Money, type FileId } from "@kosht/kernel";
import { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { JobDef } from "../../../platform/jobs/define-job.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import type { FilesFacade } from "../../files/index.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";
import { summarize } from "../domain/preview.ts";
import type { ColumnSchema, Role } from "../domain/types.ts";
import { statementsImported, statementsRolledBack } from "../events.ts";
import type { ImportPayload, PreviewRow } from "../domain/import-types.ts";
import {
  deleteImportRow,
  existingImportIds,
  findImport,
  insertImport,
  listImports,
  lockImport,
  updateImport,
  type ImportRow,
} from "../infrastructure/db/statement-imports.repo.ts";
import { STATEMENTS_DRAFT_TTL_DAYS } from "../settings.ts";
import { UNKNOWN_BANK, type BuildPreview } from "./build-preview.ts";
import type { ParseOptions } from "./parse-statement.ts";
import type { Rememberable } from "./remember-format.ts";
import type { ParsedStatement } from "../domain/types.ts";

export const ROLLBACK_HANDLER = "statements.rollback";
export const ENTITY = "statement-import";

const RollbackPayload = z.object({ importId: z.uuid() });

export interface ImportDeps {
  readonly platform: Pick<Platform, "clock" | "log" | "jobs" | "events" | "realtime" | "settings">;
  readonly files: Pick<FilesFacade, "open" | "remove">;
  readonly accounts: Pick<
    AccountsFacade,
    "findCard" | "findOrCreate" | "unknownCard" | "setStatementBalance" | "revertStatementBalance"
  >;
  readonly transactions: Pick<
    TransactionsFacade,
    | "importBatch"
    | "deleteImport"
    | "knownKeys"
    | "countEditedInImport"
    | "requestMarkTransfer"
    | "matchBankOps"
  >;
  readonly actions: Pick<ActionsFacade, "record" | "undo">;
  readonly notifications: Pick<NotificationsFacade, "notify">;
  readonly parseStatement: (
    s: ScopedDb,
    fileId: FileId,
    options?: ParseOptions,
  ) => Promise<ParsedStatement>;
  readonly buildPreview: BuildPreview;
  readonly remember: (tx: ScopedDb, parsed: Rememberable) => Promise<boolean>;
  readonly jobs: {
    readonly parse: JobDef<{ importId: string }>;
    readonly discard: JobDef<{ importId: string }>;
  };
}

function toPeriod(parsed: ParsedStatement): { from: string; to: string } | undefined {
  if (parsed.period !== undefined) return parsed.period;
  const days = parsed.rows.map((row) => row.date).toSorted();
  const from = days[0];
  const to = days.at(-1);
  return from === undefined || to === undefined ? undefined : { from, to };
}

export function makeImports(d: ImportDeps) {
  const { clock, log, jobs, events, realtime } = d.platform;

  async function changed(tx: ScopedDb, id: string): Promise<void> {
    await realtime.changed(tx, { entity: ENTITY, ids: [id] });
  }

  async function own(s: ScopedDb, id: string): Promise<ImportRow> {
    const row = await findImport(s, id);
    if (row === undefined) throw new AppError("NOT_FOUND");
    return row;
  }

  /** Новая загрузка: черновик «разбирается» и задача parse — в одной транзакции (откат — нет ни того, ни другого). */
  async function start(s: ScopedDb, fileId: FileId): Promise<{ id: string }> {
    const file = await d.files.open(s, fileId);
    if (file.kind !== "statement") throw new AppError("VALIDATION", { reason: "file-kind" });
    return s.transaction(async (tx) => {
      const row = await insertImport(tx, { fileId, status: "parsing" });
      await jobs.enqueue(tx, d.jobs.parse, { importId: row.id });
      await changed(tx, row.id);
      return { id: row.id };
    });
  }

  /** Задача parse (worker): разбор, предпросмотр, прогресс. Ошибка файла — статус «не получилось», а не падение задачи. */
  async function run(s: ScopedDb, importId: string): Promise<void> {
    const row = await findImport(s, importId);
    if (row === undefined || row.status !== "parsing") return;
    const progress = (percent: number) =>
      realtime.progress(s.scope, { entity: ENTITY, id: importId, percent });
    try {
      await progress(10);
      const override = row.schemaOverride?.columns;
      const parsed = await d.parseStatement(
        s,
        row.fileId as FileId,
        override === undefined ? {} : { columns: override },
      );
      await progress(60);
      const preview = await d.buildPreview(s, parsed);
      const period = toPeriod(parsed);
      const closing =
        parsed.closing === undefined
          ? null
          : {
              minor: parsed.closing.minor,
              on: parsed.period?.to ?? period?.to ?? clock.today().toString(),
            };
      const payload: ImportPayload = {
        rows: preview.rows,
        schema: parsed.schema ?? null,
        fingerprint: parsed.fingerprint ?? null,
        closing,
        sample:
          parsed.sample === undefined
            ? null
            : { header: parsed.sample.header, rows: parsed.sample.rows },
      };
      await s.transaction(async (tx) => {
        await updateImport(tx, importId, {
          status: "ready",
          method: parsed.method,
          sourceKind: parsed.sourceKind,
          bank: parsed.bank ?? null,
          mask: parsed.accountMask ?? null,
          currency: parsed.currency,
          periodFrom: period?.from ?? null,
          periodTo: period?.to ?? null,
          ...preview.counts,
          balanceStatus: parsed.balance.status,
          balanceDifferenceMinor: parsed.balance.difference?.minor ?? null,
          formatChanged: parsed.formatChanged,
          warnings: [...parsed.warnings],
          payload,
          errorCode: null,
          updatedAt: clock.now(),
        });
        await changed(tx, importId);
      });
      await progress(100);
      log.info({ count: preview.counts.found, method: parsed.method }, "statements.preview-ready");
    } catch (error) {
      const code = error instanceof AppError ? error.code : "INTERNAL";
      if (!(error instanceof AppError)) log.error({ err: error }, "statements.parse-failed");
      await s.transaction(async (tx) => {
        await updateImport(tx, importId, {
          status: "failed",
          errorCode: code,
          updatedAt: clock.now(),
        });
        await changed(tx, importId);
      });
    }
  }

  /** «Исправить колонки»: роли человека, повторный разбор без модели (задача parse по новой схеме). */
  async function fixColumns(
    s: ScopedDb,
    id: string,
    columns: readonly { index: number; role: Role }[],
  ): Promise<void> {
    await s.transaction(async (tx) => {
      const row = await lockImport(tx, id);
      if (row === undefined) throw new AppError("NOT_FOUND");
      if (row.status !== "ready" && row.status !== "failed") throw new AppError("CONFLICT");
      const override: ColumnSchema = { columns, dateOrder: "dmy" };
      await updateImport(tx, id, {
        status: "parsing",
        schemaOverride: override,
        errorCode: null,
        updatedAt: clock.now(),
      });
      await jobs.enqueue(tx, d.jobs.parse, { importId: id });
      await changed(tx, id);
    });
  }

  /** «Отмена»: черновик и загруженный файл удаляются. */
  async function cancel(s: ScopedDb, id: string): Promise<void> {
    const row = await own(s, id);
    if (row.status === "imported" || row.status === "importing") throw new AppError("CONFLICT");
    await s.transaction(async (tx) => {
      await deleteImportRow(tx, id);
      await changed(tx, id);
    });
    await d.files.remove(s, row.fileId as FileId);
  }

  function toImportRow(row: PreviewRow, accountId: string, positions: ReadonlyMap<number, number>) {
    const refundOfIndex =
      row.refundOfIndex === undefined ? undefined : positions.get(row.refundOfIndex);
    return {
      accountId,
      type: row.kind,
      direction: row.direction,
      occurredOn: row.date,
      occurredTime: row.time,
      amount: Money.of(Math.abs(row.minor), row.currency),
      amountBynMinor: row.amountBynMinor,
      fxRateId: row.fxRateId,
      description: row.description,
      merchantName: row.merchantName,
      merchantKey: row.merchantKey,
      category: row.category,
      dedupeKey: row.dedupeKey,
      externalId: row.externalId,
      pairWithId: row.pairWithId,
      cashCounterpart: row.cashCounterpart,
      refundOfId: row.refundOfId,
      refundOfIndex,
    };
  }

  /** «Импортировать N»: одна транзакция — счёт, операции, остаток, формат, журнал, событие, одно уведомление. */
  async function confirm(
    s: ScopedDb,
    id: string,
  ): Promise<{
    undoToken: string;
    decisionId: string | undefined;
    imported: number;
    duplicates: number;
  }> {
    const imported = await s.transaction(async (tx) => {
      const row = await lockImport(tx, id);
      if (row === undefined) throw new AppError("NOT_FOUND");
      const payload = row.payload;
      if (row.status !== "ready" || payload === null || row.currency === null) {
        throw new AppError("CONFLICT");
      }
      const currency = row.currency;
      let accountId: string;
      let created = false;
      if (row.mask !== null) {
        const key = { bank: row.bank ?? UNKNOWN_BANK, mask: row.mask, currency };
        created = (await d.accounts.findCard(tx, key)) === undefined;
        accountId = await d.accounts.findOrCreate(tx, key);
      } else if (currency === "BYN") {
        accountId = await d.accounts.unknownCard(tx);
      } else {
        throw new AppError("VALIDATION", { reason: "account" });
      }
      // Дубли ещё раз — внутри транзакции: параллельный импорт мог записать те же операции.
      const known = await d.transactions.knownKeys(tx, {
        dedupeKeys: payload.rows.map((r) => r.dedupeKey),
        externalIds: payload.rows.flatMap((r) => r.externalId ?? []),
      });
      const live = payload.rows.filter(
        (r) =>
          r.skipped !== true &&
          !r.duplicate &&
          !known.dedupe.has(r.dedupeKey) &&
          !(r.externalId !== undefined && known.external.has(r.externalId)),
      );
      const positions = new Map(live.map((r, position) => [r.index, position]));
      const result = await d.transactions.importBatch(tx, {
        importId: id,
        rows: live.map((r) => toImportRow(r, accountId, positions)),
      });
      // Остаток из выписки с днём (STMT-02); у счёта, созданного этим импортом, — безусловно.
      const adjustment =
        payload.closing === null
          ? undefined
          : await d.accounts.setStatementBalance(tx, {
              accountId,
              balance: Money.of(payload.closing.minor, currency),
              on: LocalDate.parse(payload.closing.on),
              force: created,
            });
      await d.remember(tx, {
        ...(payload.fingerprint === null ? {} : { fingerprint: payload.fingerprint }),
        ...(payload.schema === null ? {} : { schema: payload.schema }),
        sourceKind: (row.sourceKind ?? "csv") as Rememberable["sourceKind"],
        ...(row.bank === null ? {} : { bank: row.bank }),
      });
      // Спорные переводы — пакетом «Да/Нет» (STMT-08).
      const doubtfulIds = live.flatMap((r, position) => {
        const written = result.ids[position];
        return r.doubtful && written !== undefined ? [written] : [];
      });
      const decisionId =
        doubtfulIds.length === 0
          ? undefined
          : await d.transactions.requestMarkTransfer(tx, doubtfulIds, "web");
      const undoToken = await d.actions.record(tx, {
        handler: ROLLBACK_HANDLER,
        payload: { importId: id },
        subject: `${ENTITY}:${id}`,
        channel: "web",
      });
      const counts = summarize(
        payload.rows.map((r) => ({
          ...r,
          duplicate: r.duplicate || (!live.includes(r) && r.skipped !== true),
        })),
      );
      await updateImport(tx, id, {
        status: "imported",
        newCount: live.length,
        duplicates: counts.duplicates,
        accountId,
        undoToken,
        balanceAdjustment: adjustment ?? null,
        importedAt: clock.now(),
        payload: null,
        updatedAt: clock.now(),
      });
      await events.publish(tx, statementsImported, { ids: [id] });
      await changed(tx, id);
      await d.notifications.notify(tx, {
        kind: "statement-imported",
        key: id,
        objectRef: { entity: ENTITY, id },
        ...(decisionId === undefined ? {} : { decisionId }),
        undoToken,
        params: { count: live.length, duplicates: counts.duplicates },
      });
      log.info({ count: live.length }, "statements.imported");
      return {
        undoToken,
        decisionId,
        imported: live.length,
        duplicates: counts.duplicates,
        ids: result.ids,
      };
    });
    // TXN-10: выписка записана — ищем чеки к её платежам (чек до выписки был наличной тратой, теперь привязывается).
    // Сбой сопоставления импорт не портит: операции уже записаны и учтены.
    await d.transactions.matchBankOps(s, imported.ids).catch((error: unknown) => {
      log.warn(
        { code: error instanceof AppError ? error.code : "INTERNAL" },
        "statements.match-failed",
      );
    });
    return {
      undoToken: imported.undoToken,
      decisionId: imported.decisionId,
      imported: imported.imported,
      duplicates: imported.duplicates,
    };
  }

  /** Обработчик отмены в actions (STMT-11): операции импорта удаляются, остаток возвращается, импорт — «откатан». */
  async function rollback(tx: ScopedDb, payload: unknown): Promise<void> {
    const { importId } = RollbackPayload.parse(payload);
    const row = await lockImport(tx, importId);
    if (row === undefined || row.status !== "imported") return;
    const deleted = await d.transactions.deleteImport(tx, importId);
    if (row.accountId !== null && row.balanceAdjustment !== null) {
      await d.accounts.revertStatementBalance(tx, row.accountId, row.balanceAdjustment);
    }
    await updateImport(tx, importId, {
      status: "rolled-back",
      undoToken: null,
      updatedAt: clock.now(),
    });
    await events.publish(tx, statementsRolledBack, { ids: [importId] });
    await changed(tx, importId);
    log.info({ count: deleted }, "statements.rolled-back");
  }

  /** Подтверждение отката называет, сколько операций и сколько из них правили вручную (они тоже удаляются). */
  async function rollbackInfo(
    s: ScopedDb,
    id: string,
  ): Promise<{ transactions: number; edited: number }> {
    const row = await own(s, id);
    if (row.status !== "imported") throw new AppError("CONFLICT");
    return {
      transactions: row.newCount,
      edited: await d.transactions.countEditedInImport(s, id),
    };
  }

  /** «Откатить импорт»: после подтверждения человека — «Отменить» из журнала actions. */
  async function requestRollback(
    s: ScopedDb,
    id: string,
  ): Promise<{ status: "undone" | "already-undone" }> {
    const row = await own(s, id);
    if (row.status !== "imported" || row.undoToken === null) throw new AppError("CONFLICT");
    return { status: await d.actions.undo(s, row.undoToken) };
  }

  /** Брошенный черновик: не тронут дольше TTL — удаляется вместе с файлом. */
  async function discard(s: ScopedDb, importId: string): Promise<void> {
    const row = await findImport(s, importId);
    if (row === undefined || (row.status !== "ready" && row.status !== "failed")) return;
    const days = await d.platform.settings.get(STATEMENTS_DRAFT_TTL_DAYS);
    if (clock.now().getTime() - row.updatedAt.getTime() < days * 86_400_000) return;
    await s.transaction((tx) => deleteImportRow(tx, importId));
    await d.files.remove(s, row.fileId as FileId);
    log.info({ importId }, "statements.draft-discarded");
  }

  return {
    start,
    run,
    fixColumns,
    cancel,
    confirm,
    rollback,
    rollbackInfo,
    requestRollback,
    discard,
    get: own,
    list: listImports,
    /** CHAT-03: id своих импортов среди переданных. */
    existing: existingImportIds,
  };
}

export type Imports = ReturnType<typeof makeImports>;
