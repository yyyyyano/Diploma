// REC-01, REC-02: пересчёт регулярных платежей по истории. Поиск идёт пачкой по всем контрагентам за 13 месяцев
// (настройка), а не запросом на операцию; найденное сводится с известным (domain/reconcile.ts); событие
// recurring.changed — одно, пачкой id. Идемпотентен: повторный прогон на тех же операциях ничего не пишет.
import { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { dayInMonth, dayOfMonth, monthIndex } from "../domain/dates.ts";
import { detect, type DetectSettings, type HistoryOp } from "../domain/detect.ts";
import { matchCandidate, newItemOf, patchFor, type KnownItem } from "../domain/reconcile.ts";
import {
  insertItem,
  lockAll,
  updateItem,
  type ItemRow,
  type StoredOccurrence,
} from "../infrastructure/db/recurring.repo.ts";
import { recurringChanged } from "../events.ts";
import {
  AMOUNT_TOLERANCE_PCT,
  DAY_TOLERANCE,
  HISTORY_MONTHS,
  MIN_REPEATS,
  MIN_REPEATS_YEAR,
  WEEK_TOLERANCE,
  WINDOW,
} from "../settings.ts";
import type { Deps } from "./deps.ts";
import type { makeSyncFacts } from "./facts.ts";

export function knownOf(row: ItemRow): KnownItem {
  return {
    id: row.id,
    flow: row.flow as KnownItem["flow"],
    merchantKey: row.merchantKey,
    period: row.period as KnownItem["period"],
    section: row.section as KnownItem["section"],
    state: row.state as KnownItem["state"],
    anchorDay: row.anchorDay,
    userFixed: row.userFixed,
    occurrences: row.occurrences as StoredOccurrence[],
    nextExpectedOn: LocalDate.parse(row.nextExpectedOn),
    name: row.name,
    memberIds: row.memberIds,
    lastOccurredOn: row.lastOccurredOn === null ? null : LocalDate.parse(row.lastOccurredOn),
    categoryCode: row.categoryCode,
    categoryId: row.categoryId,
  };
}

export function makeRecompute(d: Deps, syncFacts: ReturnType<typeof makeSyncFacts>) {
  const { clock, settings, events, realtime, log } = d.platform;

  async function detectSettings(): Promise<DetectSettings> {
    return {
      minRepeats: await settings.get(MIN_REPEATS),
      minRepeatsYear: await settings.get(MIN_REPEATS_YEAR),
      amountTolerancePct: await settings.get(AMOUNT_TOLERANCE_PCT),
      dayTolerance: await settings.get(DAY_TOLERANCE),
      weekTolerance: await settings.get(WEEK_TOLERANCE),
      window: await settings.get(WINDOW),
      deadAfterPeriods: 2,
    };
  }

  /** Пересчитать регулярные платежи пользователя; вернуть id изменённых. */
  return async function recompute(s: ScopedDb): Promise<string[]> {
    const today = clock.today();
    const cfg = await detectSettings();
    const months = await settings.get(HISTORY_MONTHS);
    const from = dayInMonth(monthIndex(today) - months, dayOfMonth(today));
    // Историю читаем до транзакции: пересчёт — чтение пачкой, а не запись.
    const rows = await d.transactions.recurringHistory(s, { from, to: today });
    const history: HistoryOp[] = rows.map((row) => ({
      id: row.id,
      merchantKey: row.merchantKey,
      merchantName: row.merchantName,
      flow: row.type,
      on: LocalDate.parse(row.occurredOn),
      amountMinor: row.amountBynMinor,
      categoryCode: row.categoryCode,
      categoryId: row.categoryId,
    }));
    const candidates = detect(history, today, cfg);
    const changed = await s.transaction(async (tx) => {
      const known = (await lockAll(tx)).map(knownOf);
      const taken = new Set<string>();
      const ids: string[] = [];
      for (const candidate of candidates) {
        const match = matchCandidate(candidate, known, taken, cfg);
        if (match === undefined) {
          const id = await insertItem(tx, newItemOf(candidate));
          // Параллельный поиск успел раньше: серию доведёт следующий пересчёт.
          if (id !== undefined) ids.push(id);
          continue;
        }
        taken.add(match.id);
        const patch = patchFor(match, candidate);
        if (patch === undefined) continue;
        await updateItem(tx, match.id, patch, clock.now());
        ids.push(match.id);
      }
      if (ids.length > 0) {
        await events.publish(tx, recurringChanged, { ids });
        await realtime.changed(tx, { entity: "recurring", ids });
      }
      return ids;
    });
    if (changed.length > 0) {
      await syncFacts(s);
      log.info({ count: changed.length }, "recurring.recomputed");
    }
    return changed;
  };
}
