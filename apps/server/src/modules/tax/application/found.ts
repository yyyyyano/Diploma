// Найденные вычеты (TAX-20): чтение, «показан», «Не моё» / «Оформлено» / «Вернуть» с «Отменить» (P5). Состояния: новый → показан →
// отклонён (больше не предлагается) | оформлен; запись одна на основание, поэтому отклонённое не возвращается само при новом событии.
import type { FoundDeduction, FoundStatus, FoundList } from "@kosht/contract";
import { FoundDeductionId } from "@kosht/contract";
import { Money, TraceId } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import {
  findFound,
  listFound,
  markShown,
  setStatus,
  type FoundRow,
} from "../infrastructure/db/found.repo.ts";

export const RESTORE_HANDLER = "tax.restore-found";

const BYN = "BYN";
const STATUSES: readonly FoundStatus[] = ["new", "shown", "dismissed", "filed"];

export interface FoundDeps {
  readonly platform: Pick<Platform, "realtime">;
  readonly actions: Pick<ActionsFacade, "record">;
}

/** Строка таблицы → найденный вычет контракта: сумма — с traceId расчёта, основание — снимок операции. */
export function toFound(row: FoundRow): FoundDeduction {
  return {
    id: FoundDeductionId.parse(row.id),
    kind: row.kind as FoundDeduction["kind"],
    status: row.status as FoundStatus,
    reason: row.reason as FoundDeduction["reason"],
    year: row.year,
    amount:
      row.amountMinor === null || row.traceId === null
        ? null
        : { amount: Money.of(row.amountMinor, BYN), traceId: TraceId.parse(row.traceId) },
    payee: row.payee,
    operation:
      row.operationId === null || row.basisOn === null || row.basisMinor === null
        ? null
        : { id: row.operationId, on: row.basisOn as never, amount: Money.of(row.basisMinor, BYN) },
    foundOn: row.foundOn as never,
  };
}

export function makeFound(d: FoundDeps) {
  /** Все найденные вычеты пользователя; сайту и инструменту. */
  async function list(s: ScopedDb): Promise<FoundList> {
    return { items: (await listFound(s)).map(toFound) };
  }

  /** Найденные, которые ещё предлагаются (новые и показанные) — карточка главной. */
  async function active(s: ScopedDb): Promise<FoundDeduction[]> {
    return (await listFound(s))
      .filter((row) => row.status === "new" || row.status === "shown")
      .map(toFound);
  }

  async function shown(s: ScopedDb, ids: readonly string[]): Promise<void> {
    await markShown(s, ids);
  }

  /** «Это не моё», «Оформлено», «Вернуть»: сразу, с токеном «Отменить» — прежнее состояние. */
  async function change(
    s: ScopedDb,
    id: string,
    status: "dismissed" | "filed" | "shown",
  ): Promise<{ found: FoundDeduction; undoToken: string }> {
    return s.transaction(async (tx) => {
      const row = await findFound(tx, id);
      if (row === undefined) throw new AppError("NOT_FOUND");
      await setStatus(tx, id, status);
      const undoToken = await d.actions.record(tx, {
        handler: RESTORE_HANDLER,
        payload: { foundId: id, before: row.status },
        subject: `found-deduction:${id}`,
        channel: "web",
      });
      await d.platform.realtime.changed(tx, { entity: "deduction", ids: [id] });
      return { found: toFound({ ...row, status }), undoToken };
    });
  }

  /** «Отменить» (реестр undo): вычет в том состоянии, в каком был до действия. */
  async function restore(tx: ScopedDb, payload: unknown): Promise<void> {
    const body = payload as { foundId?: unknown; before?: unknown } | null;
    const id = body?.foundId;
    const before = body?.before;
    if (typeof id !== "string" || typeof before !== "string") return;
    if (!STATUSES.includes(before as FoundStatus)) return;
    const row = await findFound(tx, id);
    if (row === undefined) return;
    await setStatus(tx, id, before);
    await d.platform.realtime.changed(tx, { entity: "deduction", ids: [id] });
  }

  return { list, active, shown, change, restore };
}

export type Found = ReturnType<typeof makeFound>;
