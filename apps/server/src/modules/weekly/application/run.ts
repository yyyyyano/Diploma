// Итоги недели для одного пользователя (WEEK-01, WEEK-03, NFR-22): обход раз в 15 минут ставит задачу каждому владельцу включённых
// сводок, а срок сверяет задача по часам и поясу системы: «последний наступивший момент расписания (день и время пользователя) и
// неделя перед ним — сводка есть?». Нет — собрать числа, написать текст, сохранить и уведомить. Выключенный компьютер ничего не
// теряет: на первом обходе после запуска наступивший момент находится сам, а пропущенные недели не копятся — один итог за последнюю.
import { timeOfDay } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { TIME_ZONE } from "../../../platform/settings/time-zone.ts";
import { weekToSummarize } from "../domain/schedule.ts";
import {
  findPreferences,
  findSummaryByWeek,
  insertSummary,
} from "../infrastructure/db/weekly.repo.ts";
import { DEFAULT_TIME, DEFAULT_WEEKDAY } from "../settings.ts";
import type { Deps } from "./deps.ts";
import type { Facts } from "./facts.ts";
import type { Text } from "./text.ts";

export type RunResult = "off" | "not-due" | "empty" | "created";

export function makeRun(d: Deps, facts: Facts, text: Text) {
  const { clock, settings, log } = d.platform;

  return async function run(s: ScopedDb): Promise<RunResult> {
    const prefs = await findPreferences(s);
    if (prefs !== undefined && !prefs.enabled) return "off";
    const weekday = prefs?.weekday ?? (await settings.get(DEFAULT_WEEKDAY));
    const time = prefs?.time ?? (await settings.get(DEFAULT_TIME));
    const today = clock.today();
    const week = weekToSummarize({
      today,
      now: timeOfDay(clock.now(), await settings.get(TIME_ZONE)),
      weekday,
      time,
    });
    if ((await findSummaryByWeek(s, week.weekStart)) !== undefined) return "not-due";

    const built = await facts.build(s, week, today);
    // Операций до конца недели нет — сводки нет, но неделя отмечена обработанной (без этого обход строил бы её каждые 15 минут).
    if (built === null) {
      await s.transaction((tx) =>
        insertSummary(tx, { weekStart: week.weekStart, status: "empty" }),
      );
      return "empty";
    }
    const { text: written, source } = await text.compose(s, built);
    await s.transaction(async (tx) => {
      const inserted = await insertSummary(tx, {
        weekStart: week.weekStart,
        status: "ok",
        facts: built as unknown as Record<string, unknown>,
        text: written,
        textSource: source,
      });
      if (!inserted) return;
      await d.notifications.notify(tx, {
        kind: "weekly-summary",
        key: week.weekStart,
        params: { weekStart: week.weekStart },
      });
    });
    log.info({ status: source }, "weekly.created");
    return "created";
  };
}

export type Run = ReturnType<typeof makeRun>;
