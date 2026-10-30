// Пороги уведомлений (BUD-03, BUD-07). Лимит: 80 и 100 % — по одному разу на «лимит + месяц + порог»; в новом месяце
// счётчик с нуля. Цель: 50 и 100 % — по разу на цель, «отстаёт от графика» — не чаще раза в месяц на цель. Одноразовость
// держит уникальный ключ в `budget_alerts` (вставка ON CONFLICT DO NOTHING) в той же транзакции, что и уведомление:
// повтор доставки или параллельный пересчёт второго уведомления не создаёт. Если порогов достигнуто сразу несколько
// (импорт перепрыгнул 80 %), уведомляем о высшем, остальные помечаем отправленными: «80 %» при 112 % — ложь.
import { GOAL_THRESHOLDS, LIMIT_THRESHOLDS } from "@kosht/contract";
import { reachedThresholds } from "@kosht/calc";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { daysLeft, monthOf } from "../domain/month.ts";
import { claimAlert, listGoals } from "../infrastructure/db/budgets.repo.ts";
import type { Deps } from "./deps.ts";
import type { GoalCalc, Overview } from "./overview.ts";

export function makeThresholds(d: Deps, overview: Overview) {
  const { clock, log } = d.platform;

  /** Лимиты текущего месяца: сколько уведомлений отправлено. */
  async function recheckLimits(s: ScopedDb): Promise<number> {
    const today = clock.today();
    const month = monthOf(today);
    const limits = await overview.limitsOfMonth(s, month);
    let sent = 0;
    for (const { row, spent, percent } of limits) {
      const enabled = LIMIT_THRESHOLDS.filter((t) => (t === 80 ? row.notifyAt80 : row.notifyAt100));
      const reached = reachedThresholds(percent.value, enabled);
      if (reached.length === 0) continue;
      const top = await s.transaction(async (tx) => {
        const fresh: number[] = [];
        for (const threshold of reached) {
          if (await claimAlert(tx, row.id, `${month}:${String(threshold)}`)) fresh.push(threshold);
        }
        const highest = fresh.at(-1);
        if (highest === undefined) return undefined;
        await d.notifications.notify(tx, {
          kind: "limit",
          key: `${row.id}:${month}:${String(highest)}`,
          objectRef: { entity: "limit", id: row.id },
          params: {
            threshold: highest,
            percent: percent.value,
            category: row.categoryKey,
            daysLeft: daysLeft(today, month),
            spent: spent.value.minor,
            limit: row.limitMinor,
          },
        });
        return highest;
      });
      if (top !== undefined) {
        sent += 1;
        log.info({ limitId: row.id, reason: `limit-${String(top)}` }, "budgets.limit-notified");
      }
    }
    return sent;
  }

  /** 50 и 100 % цели: по разу на цель. */
  async function notifyProgress(s: ScopedDb, calcs: readonly GoalCalc[]): Promise<number> {
    let sent = 0;
    for (const { row, percent } of calcs) {
      if (percent === null) continue;
      const reached = reachedThresholds(percent.value, GOAL_THRESHOLDS);
      if (reached.length === 0) continue;
      const top = await s.transaction(async (tx) => {
        const fresh: number[] = [];
        for (const threshold of reached) {
          if (await claimAlert(tx, row.id, String(threshold))) fresh.push(threshold);
        }
        const highest = fresh.at(-1);
        if (highest === undefined) return undefined;
        await d.notifications.notify(tx, {
          kind: "goal",
          key: `${row.id}:${String(highest)}`,
          objectRef: { entity: "goal", id: row.id },
          params: {
            reason: highest === 100 ? "done" : "half",
            percent: percent.value,
            name: row.name,
          },
        });
        return highest;
      });
      if (top !== undefined) {
        sent += 1;
        log.info({ goalId: row.id, reason: `goal-${String(top)}` }, "budgets.goal-notified");
      }
    }
    return sent;
  }

  /** После импорта или взноса: у всех целей прогресс мог дойти до 50 или 100 %. */
  async function recheckGoals(s: ScopedDb): Promise<number> {
    return notifyProgress(s, await overview.goalCalcs(s, await listGoals(s)));
  }

  /** BUD-07: ежедневная проверка одной цели — 50/100 % и «отстаёт от графика» не чаще раза в месяц. */
  async function checkGoal(s: ScopedDb, goalId: string): Promise<number> {
    const rows = (await listGoals(s)).filter((row) => row.id === goalId);
    const calcs = await overview.goalCalcs(s, rows);
    let sent = await notifyProgress(s, calcs);
    const [calc] = calcs;
    if (calc === undefined || !calc.behind) return sent;
    const month = monthOf(clock.today());
    const notified = await s.transaction(async (tx) => {
      if (!(await claimAlert(tx, goalId, `behind:${month}`))) return false;
      await d.notifications.notify(tx, {
        kind: "goal",
        key: `${goalId}:behind:${month}`,
        objectRef: { entity: "goal", id: goalId },
        params: { reason: "behind", percent: calc.percent?.value ?? 0, name: calc.row.name },
      });
      return true;
    });
    if (notified) {
      sent += 1;
      log.info({ goalId, reason: "goal-behind" }, "budgets.goal-notified");
    }
    return sent;
  }

  return { recheckLimits, recheckGoals, checkGoal };
}

export type Thresholds = ReturnType<typeof makeThresholds>;
