// «Добавить акт по ссылке / списком» и «Добавить» из очереди (LAW-16, LAW-40): задача worker идёт по ID, каждый акт — через
// ручное добавление пополнения каталога (без фильтров LAW-13: решение принял человек). Итог — одна строка журнала обновлений с
// числами. Остановка загрузчика (403/429, пустой контакт) — уведомление администратору и повторяемая ошибка.
import type { Clock } from "@kosht/kernel";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import { logUpdate } from "../infrastructure/db/catalog.repo.ts";
import type { CatalogGrowth } from "./catalog-growth.ts";
import { LoaderStopped } from "./ports.ts";

export interface AddActsDeps {
  readonly system: SystemDb;
  readonly growth: Pick<CatalogGrowth, "addManual">;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifications: Pick<NotificationsFacade, "notifyAdmins">;
}

export function makeAddActs(d: AddActsDeps) {
  return async function run(pravoIds: readonly string[], signal?: AbortSignal): Promise<void> {
    const counts = { added: 0, known: 0, notFound: 0, failed: 0 };
    for (const pravoId of pravoIds) {
      signal?.throwIfAborted();
      try {
        const outcome = await d.growth.addManual(pravoId);
        if (outcome === "added" || outcome === "restored") counts.added += 1;
        else if (outcome === "known") counts.known += 1;
        else if (outcome === "later") counts.failed += 1;
        else counts.notFound += 1;
      } catch (error) {
        if (error instanceof LoaderStopped) {
          await d.notifications.notifyAdmins({
            kind: "law-update-failed",
            key: `loader-stopped:${error.reason}:${d.clock.today()}`,
            params: { reason: error.reason },
          });
          throw new AppError("UNAVAILABLE");
        }
        d.log.warn({ code: "add-act-failed" }, "law.add-acts.failed");
        counts.failed += 1;
      }
    }
    await logUpdate(d.system, {
      at: d.clock.now(),
      actId: null,
      event: "add-acts",
      details: counts,
    });
  };
}

export type AddActs = ReturnType<typeof makeAddActs>;
