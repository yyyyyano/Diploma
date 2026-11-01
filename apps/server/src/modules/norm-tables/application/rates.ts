// Таблица ставок (TAX-03, ADM-11, LEGAL-08): ответ калькулятору — только подтверждённое значение или явное «нет данных»;
// админка — все версии, «предложить» (в силу не вступает), «Подтвердить», «Отклонить». Деньги — копейки, проценты — сотые доли
// процента; числа здесь не считаются, только хранятся и отдаются с источником.
import type { ProposeRateInput, RateRow, RatesTable } from "@kosht/contract";
import type { Clock } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import { paramDef, type RateUnit } from "../domain/params.ts";
import { pathKeyOf } from "../domain/source.ts";
import {
  allRates,
  confirmedAt,
  confirmPending,
  findRate,
  pendingAt,
  rejectPending,
  savePending,
  type RateRecord,
} from "../infrastructure/db/rates.repo.ts";

/** Ответ калькулятору: значение с источником или причина, почему его нет (P1: калькулятор так и говорит). */
export type RateAnswer =
  | {
      readonly found: true;
      readonly param: string;
      readonly unit: RateUnit;
      readonly value: number;
      readonly validFrom: string;
      readonly validTo: string | null;
      readonly source: {
        readonly act: string | null;
        readonly article: string | null;
        readonly point: string | null;
        readonly url: string | null;
      };
      readonly confirmedBy: "developer" | "admin";
      readonly confirmedOn: string;
      /** Версия фрагмента нормы, где найдено число (сверка LAW-33): основание в трассе «Откуда эта цифра?»; нет — null. */
      readonly versionId: string | null;
    }
  | { readonly found: false; readonly reason: "no-data" | "unconfirmed" };

export interface RatesDeps {
  readonly system: SystemDb;
  readonly clock: Clock;
  /** Публикация `norm-tables.values-confirmed` в транзакции подтверждающего администратора. */
  readonly publishConfirmed: (tx: ScopedDb, ids: readonly string[]) => Promise<void>;
}

function toRow(r: RateRecord): RateRow {
  const def = paramDef(r.param);
  return {
    id: r.id,
    param: r.param,
    unit: def?.unit ?? "byn-minor",
    group: def?.group ?? "std-deduction",
    validFrom: r.validFrom,
    validTo: r.validTo,
    value: r.value,
    status: r.status === "confirmed" || r.status === "superseded" ? r.status : "pending",
    source: {
      act: r.sourceAct,
      article: r.sourceArticle,
      point: r.sourcePoint,
      url: r.sourceUrl,
      linked: r.sourceVersionId !== null,
    },
    confirmed:
      r.confirmedByKind === null || r.confirmedOn === null
        ? null
        : { by: r.confirmedByKind === "developer" ? "developer" : "admin", on: r.confirmedOn },
    drift: r.driftAt !== null,
  };
}

export function makeRates(d: RatesDeps) {
  /** Подтверждённое значение параметра на день (TAX-03). Нет подтверждённого — «нет данных» или «ждёт подтверждения» (LEGAL-08). */
  async function value(param: string, on: string): Promise<RateAnswer> {
    const def = paramDef(param);
    if (def === undefined) return { found: false, reason: "no-data" };
    const row = await confirmedAt(d.system, param, on);
    if (row === undefined || row.confirmedByKind === null || row.confirmedOn === null) {
      return {
        found: false,
        reason: (await pendingAt(d.system, param, on)) ? "unconfirmed" : "no-data",
      };
    }
    return {
      found: true,
      param,
      unit: def.unit,
      value: row.value,
      validFrom: row.validFrom,
      validTo: row.validTo,
      source: {
        act: row.sourceAct,
        article: row.sourceArticle,
        point: row.sourcePoint,
        url: row.sourceUrl,
      },
      confirmedBy: row.confirmedByKind === "developer" ? "developer" : "admin",
      confirmedOn: row.confirmedOn,
      versionId: row.sourceVersionId,
    };
  }

  async function table(): Promise<RatesTable> {
    const items = (await allRates(d.system)).map(toRow);
    return {
      items,
      counts: {
        pending: items.filter((r) => r.status === "pending").length,
        drift: items.filter((r) => r.status === "confirmed" && r.drift).length,
      },
    };
  }

  /** Предложить значение (ADM-11): неизвестный параметр, перевёрнутый период или нет источника — `VALIDATION` с полем. */
  async function propose(input: ProposeRateInput): Promise<RatesTable> {
    if (paramDef(input.param) === undefined) {
      throw new AppError("VALIDATION", { field: "param", reason: "unknown-param" });
    }
    if (input.validTo !== null && input.validTo < input.validFrom) {
      throw new AppError("VALIDATION", { field: "validTo", reason: "period" });
    }
    const hasAct =
      input.sourceAct !== null && input.sourceArticle !== null && input.sourceArticle !== "";
    if (!hasAct && input.sourceUrl === null) {
      throw new AppError("VALIDATION", { field: "source", reason: "required" });
    }
    const path = hasAct ? pathKeyOf(input.sourceArticle, input.sourcePoint) : null;
    if (hasAct && path === null) {
      throw new AppError("VALIDATION", { field: "sourceArticle", reason: "format" });
    }
    await savePending(d.system, {
      param: input.param,
      validFrom: input.validFrom,
      validTo: input.validTo,
      value: input.value,
      sourceAct: hasAct ? input.sourceAct : null,
      sourcePath: path,
      sourceArticle: input.sourceArticle === "" ? null : input.sourceArticle,
      sourcePoint: input.sourcePoint === "" ? null : input.sourcePoint,
      sourceUrl: input.sourceUrl,
    });
    return table();
  }

  /** «Подтвердить» (ADM-11): значение вступает в силу; событие — в одной транзакции с подтверждением администратора. */
  async function confirm(s: ScopedDb, id: string): Promise<RatesTable> {
    if ((await findRate(d.system, id)) === undefined) throw new AppError("NOT_FOUND");
    // Подтверждение и событие — одна транзакция: событие не теряется и не уходит без подтверждения.
    const result = await s.transaction(async (tx) => {
      const out = await confirmPending(tx.db, id, "admin", d.clock.today());
      if (out.result === "confirmed") await d.publishConfirmed(tx, [id]);
      return out.result;
    });
    if (result === "not-found") throw new AppError("NOT_FOUND");
    if (result === "overlap") throw new AppError("CONFLICT", { reason: "period-overlap" });
    return table();
  }

  async function reject(id: string): Promise<RatesTable> {
    if (!(await rejectPending(d.system, id))) throw new AppError("NOT_FOUND");
    return table();
  }

  return { value, table, propose, confirm, reject };
}

export type Rates = ReturnType<typeof makeRates>;
