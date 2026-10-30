// Ежедневная проверка (LAW-30, NFR-22): тексты загруженных актов (лёгкая проверка HEAD, затем полная загрузка и сверка версий,
// LAW-31, карантин LAW-39), карточки актов индекса — ежедневно, остальных — раз в неделю (утрата силы LAW-34, изменения LAW-32);
// после прохода векторизуются только изменённые версии. Остановка загрузчика (403/429, контакт) — уведомление админу и
// повторяемая ошибка: прогон повторится, пока не пройдёт. Расписание — jobs/daily-check.schedule.ts.
import type { Clock } from "@kosht/kernel";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import { checkableActs, markActState } from "../infrastructure/db/catalog.repo.ts";
import { actsDueForCard } from "../infrastructure/db/changes.repo.ts";
import type { ActCheck, TextOutcome } from "./act-check.ts";
import type { Embedder } from "./embed.ts";
import { LoaderStopped } from "./ports.ts";

export interface DailyCheckDeps {
  readonly system: SystemDb;
  readonly check: ActCheck;
  readonly embedder: Pick<Embedder, "run">;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifications: Pick<NotificationsFacade, "notifyAdmins">;
}

const DAY_MS = 86_400_000;

export interface DailyCheckResult {
  readonly text: Record<TextOutcome | "failed", number>;
  readonly cards: number;
  readonly repealed: number;
}

export function makeDailyCheck(d: DailyCheckDeps) {
  return async function run(signal?: AbortSignal): Promise<DailyCheckResult> {
    const text: Record<TextOutcome | "failed", number> = {
      "unchanged-head": 0,
      updated: 0,
      same: 0,
      quarantined: 0,
      applied: 0,
      other: 0,
      failed: 0,
    };
    let cards = 0;
    let repealed = 0;
    const now = d.clock.now().getTime();
    try {
      for (const act of await checkableActs(d.system)) {
        signal?.throwIfAborted();
        try {
          text[await d.check.checkText(act)] += 1;
        } catch (error) {
          if (error instanceof LoaderStopped) throw error;
          // Акт откладывается до следующего цикла (LAW-38): остальные проверяются дальше.
          await markActState(d.system, act.id, { loadState: "failed", lastProblem: "load-failed" });
          d.log.warn({ code: "load-failed" }, "law.daily-check.act-failed");
          text.failed += 1;
        }
      }
      // Карточки: индекс — раз в сутки, остальные акты (карточка, карантин, ошибка) — раз в неделю (LAW-30).
      const due = [
        ...(await actsDueForCard(d.system, {
          indexed: true,
          before: new Date(now - 20 * 3_600_000),
        })),
        ...(await actsDueForCard(d.system, { indexed: false, before: new Date(now - 7 * DAY_MS) })),
      ];
      for (const act of due) {
        signal?.throwIfAborted();
        try {
          cards += 1;
          if ((await d.check.checkCard(act)) === "repealed") repealed += 1;
        } catch (error) {
          if (error instanceof LoaderStopped) throw error;
          d.log.warn({ code: "card-failed" }, "law.daily-check.card-failed");
        }
      }
    } catch (error) {
      if (!(error instanceof LoaderStopped)) throw error;
      await d.notifications.notifyAdmins({
        kind: "law-update-failed",
        key: `loader-stopped:${error.reason}:${d.clock.today()}`,
        params: { reason: error.reason },
      });
      throw new AppError("UNAVAILABLE");
    }
    // Векторы — только у новых версий; нет модели — «ждём модель», проверка от этого не падает (LAW-10).
    await d.embedder.run(signal === undefined ? undefined : { signal });
    d.log.info({ count: text.updated + text.applied }, "law.daily-check.done");
    return { text, cards, repealed };
  };
}

export type DailyCheck = ReturnType<typeof makeDailyCheck>;
