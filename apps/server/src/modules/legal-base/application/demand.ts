// Догрузка по требованию (LAW-09): вопрос назвал акт каталога с текстом, но без индекса — система загружает его сразу. `api` на
// pravo.by сам не ходит: ставит задачу `legal-base.load-act` с приоритетом (worker — единственная очередь запросов, LAW-35) и
// ждёт её не дольше настройки (15 с). Не дождался или предел в сутки (по умолчанию 20) исчерпан — вызывающий отдаёт карточку
// со ссылкой; на пределе администратор получает уведомление.
import { setTimeout as sleep } from "node:timers/promises";
import type { Clock } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import { findAct } from "../infrastructure/db/catalog.repo.ts";
import { demandLoadsSince, recordDemandLoad } from "../infrastructure/db/changes.repo.ts";

export type DemandOutcome = "loaded" | "timeout" | "limit";

export interface DemandDeps {
  readonly system: SystemDb;
  /** Поставить задачу загрузки акта владельцу `s` (в транзакции); приоритет задаёт сама задача. */
  readonly enqueue: (s: ScopedDb, pravoId: string) => Promise<void>;
  readonly limitPerDay: () => Promise<number>;
  readonly waitMs: () => Promise<number>;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifications: Pick<NotificationsFacade, "notifyAdmins">;
  /** Опрос состояния акта, мс (тесты — быстрее). */
  readonly pollMs?: number;
}

const DAY_MS = 86_400_000;

export function makeDemand(d: DemandDeps) {
  return async function ensureLoaded(s: ScopedDb, pravoId: string): Promise<DemandOutcome> {
    const act = await findAct(d.system, pravoId);
    if (act === undefined) return "timeout";
    if (act.loadState === "loaded") return "loaded";
    const now = d.clock.now();
    if (
      (await demandLoadsSince(d.system, new Date(now.getTime() - DAY_MS))) >=
      (await d.limitPerDay())
    ) {
      await d.notifications.notifyAdmins({
        kind: "law-update-failed",
        key: `demand-limit:${d.clock.today()}`,
        params: { reason: "DEMAND_LIMIT" },
      });
      d.log.warn({}, "law.demand.limit");
      return "limit";
    }
    await recordDemandLoad(d.system, act.id, now);
    await d.enqueue(s, pravoId);
    const poll = d.pollMs ?? 250;
    // Ожидание состояния акта, а не времени: задача worker переведёт его в «загружен»; не дольше настройки.
    for (let waited = 0; waited <= (await d.waitMs()); waited += poll) {
      const state = (await findAct(d.system, pravoId))?.loadState;
      if (state === "loaded") return "loaded";
      if (state === "card-only") return "timeout";
      await sleep(poll);
    }
    return "timeout";
  };
}

export type Demand = ReturnType<typeof makeDemand>;
