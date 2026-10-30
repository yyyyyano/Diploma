// Ежедневная проверка текстов (LAW-30, NFR-22): все загруженные акты с текстом перечитываются вежливым загрузчиком; новая
// редакция сопоставляется с действующими версиями (LAW-31), вёрстка, не прошедшая проверку, уходит в карантин (LAW-39);
// после прохода векторизуются только изменённые версии. Остановка загрузчика (403/429, контакт) — уведомление админу и
// повторяемая ошибка: прогон повторится, пока не пройдёт. Расписание — jobs/daily-check.schedule.ts.
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { Clock } from "@kosht/kernel";
import type { NotificationsFacade } from "../../notifications/index.ts";
import { checkableActs, markActState } from "../infrastructure/db/catalog.repo.ts";
import type { Embedder } from "./embed.ts";
import type { LoadAct, LoadOutcome } from "./load-act.ts";
import { LoaderStopped } from "./ports.ts";

export interface DailyCheckDeps {
  readonly system: SystemDb;
  readonly loadAct: LoadAct;
  readonly embedder: Pick<Embedder, "run">;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifications: Pick<NotificationsFacade, "notifyAdmins">;
}

export function makeDailyCheck(d: DailyCheckDeps) {
  return async function run(signal?: AbortSignal): Promise<Record<LoadOutcome | "failed", number>> {
    const counts: Record<LoadOutcome | "failed", number> = {
      applied: 0,
      unchanged: 0,
      changed: 0,
      quarantined: 0,
      "card-only": 0,
      "unknown-act": 0,
      failed: 0,
    };
    for (const act of await checkableActs(d.system)) {
      signal?.throwIfAborted();
      try {
        counts[await d.loadAct(act.pravoId, signal)] += 1;
      } catch (error) {
        if (error instanceof LoaderStopped) {
          await d.notifications.notifyAdmins({
            kind: "law-update-failed",
            key: `loader-stopped:${error.reason}:${d.clock.today()}`,
            params: { reason: error.reason },
          });
          throw new AppError("UNAVAILABLE");
        }
        // Акт откладывается до следующего цикла (LAW-38): остальные проверяются дальше.
        await markActState(d.system, act.id, { loadState: "failed", lastProblem: "load-failed" });
        d.log.warn({ code: "load-failed" }, "law.daily-check.act-failed");
        counts.failed += 1;
      }
    }
    // Векторы — только у новых версий; нет модели — «ждём модель», проверка от этого не падает (LAW-10).
    await d.embedder.run(signal === undefined ? undefined : { signal });
    d.log.info({ count: counts.changed + counts.applied }, "law.daily-check.done");
    return counts;
  };
}

export type DailyCheck = ReturnType<typeof makeDailyCheck>;
