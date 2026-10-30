// «Откуда эта цифра?» (EXPL-01, EXPL-02, P2, ADR-0017): модуль, показывающий число, сохраняет его расчёт
// (save → traceId) и отдаёт traceId рядом с числом; сайт и инструмент explain_number читают ровно сохранённую
// трассу — не пересчитывают. Чужой или неизвестный traceId — NOT_FOUND.
import type { Calc } from "@kosht/calc";
import { TraceId, type Period, type TraceValue } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { StoredExplanation } from "../domain/explanation.ts";
import { traceHash } from "../domain/trace-hash.ts";
import { findExplanation, insertExplanations } from "../infrastructure/db/explanations.repo.ts";

export function makeExplanations(d: Pick<Platform, "clock">) {
  /** Сохранить расчёты пачкой: одинаковый расчёт — тот же traceId, таблица не растёт от повторных открытий (EXPL-02). */
  async function saveMany(
    s: ScopedDb,
    calcs: readonly Calc<TraceValue>[],
    options: { readonly period?: Period } = {},
  ): Promise<TraceId[]> {
    const ids = await insertExplanations(
      s,
      calcs.map((calc) => ({
        trace: calc.trace,
        period: options.period,
        hash: traceHash(calc.trace, options.period),
      })),
      d.clock.now(),
    );
    return ids.map((id) => TraceId.parse(id));
  }

  /** Сохранить расчёт (в транзакции модуля-владельца — tx); период — за что считали. */
  async function save(
    s: ScopedDb,
    calc: Calc<TraceValue>,
    options: { readonly period?: Period } = {},
  ): Promise<TraceId> {
    const [id] = await saveMany(s, [calc], options);
    if (id === undefined) throw new Error("explanations: save не вернул id.");
    return id;
  }

  async function get(s: ScopedDb, id: string): Promise<StoredExplanation> {
    const found = await findExplanation(s, id);
    if (found === undefined) throw new AppError("NOT_FOUND");
    return found;
  }

  return { save, saveMany, get };
}

export type Explanations = ReturnType<typeof makeExplanations>;
