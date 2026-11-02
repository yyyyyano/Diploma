// История итогов недели для демо (DEMO-01, DEMO-02): за N прошлых полных недель считаются те же числа, что у обычной сводки
// (`facts.build`: соседи и calc, у каждого числа traceId), а текст — шаблон словаря, без модели: генерация демо не вызывает
// моделей и не тратит лимиты. Уведомлений нет (это история, а не «итоги готовы»); повтор ничего не дублирует (неделя уникальна).
import { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { mondayOf } from "../domain/schedule.ts";
import { insertSummary } from "../infrastructure/db/weekly.repo.ts";
import type { Deps } from "./deps.ts";
import type { Facts } from "./facts.ts";
import type { Text } from "./text.ts";

export function makeBackfill(
  d: Pick<Deps, "platform">,
  facts: Facts,
  text: Pick<Text, "template">,
) {
  const { clock, log } = d.platform;

  /** Построить итоги за `weeks` прошлых полных недель (пн–вс) до текущей; вернуть, сколько создано. */
  return async function backfill(s: ScopedDb, input: { readonly weeks: number }): Promise<number> {
    const lastStart = LocalDate.addDays(mondayOf(clock.today()), -7);
    let created = 0;
    for (let back = input.weeks - 1; back >= 0; back--) {
      const weekStart = LocalDate.addDays(lastStart, -7 * back);
      const week = { weekStart, weekEnd: LocalDate.addDays(weekStart, 6) };
      // Дни «впереди» считаются от конца недели, а не от сегодня: история рассказывает о своей неделе.
      const today = LocalDate.addDays(week.weekEnd, 1);
      const built = await facts.build(s, week, today, week.weekEnd.slice(0, 7));
      if (built === null) continue;
      const inserted = await s.transaction((tx) =>
        insertSummary(tx, {
          weekStart,
          status: "ok",
          facts: built as unknown as Record<string, unknown>,
          text: text.template(built),
          textSource: "template",
        }),
      );
      if (inserted) created += 1;
    }
    log.info({ count: created }, "weekly.backfilled");
    return created;
  };
}

export type Backfill = ReturnType<typeof makeBackfill>;
