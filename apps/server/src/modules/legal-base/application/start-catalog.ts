// Стартовый каталог (LAW-10, AUTH-10): после первого запуска система сама заводит 28 актов и загружает их по одному
// вежливым загрузчиком; прогресс «Загружено N из 28» читает экран первого запуска. Задача переживает перезапуск
// (pg-boss) и продолжает с места остановки: загружены только акты в состоянии «ждёт» или «ошибка». Остановка загрузчика
// (контакт, 403/429, много ошибок) и акты с ошибкой — повторяемая ошибка задачи: повтор через 30 минут, до следующих суток
// сам запрос не уходит (LAW-38).
import type { Clock } from "@kosht/kernel";
import type { LawsStartupProgress } from "@kosht/contract";
import type { SystemDb } from "../../../platform/db/system-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Logger } from "../../../platform/logging/logger.ts";
import type { Settings } from "../../../platform/settings/settings.ts";
import type { NotificationsFacade } from "../../notifications/index.ts";
import { START_CATALOG } from "../domain/start-catalog.ts";
import {
  actsToLoad,
  countActs,
  markActState,
  findAct,
  seedActs,
} from "../infrastructure/db/catalog.repo.ts";
import { LEGAL_AUTOLOAD, LOADER_CONTACT } from "../settings.ts";
import type { LoadAct } from "./load-act.ts";
import {
  LoaderStopped,
  PageTooLarge,
  RobotsDenied,
  SourceUnavailable,
  type LoaderStore,
} from "./ports.ts";

export interface StartCatalogDeps {
  readonly system: SystemDb;
  readonly loadAct: LoadAct;
  readonly settings: Pick<Settings, "get">;
  readonly clock: Clock;
  readonly log: Logger;
  readonly notifications: Pick<NotificationsFacade, "notifyAdmins">;
  readonly loader: Pick<LoaderStore, "read">;
}

/** Код проблемы акта по классу ошибки: в БД и журнал — только код. */
function problemOf(error: unknown): string {
  if (error instanceof SourceUnavailable) return "source-unavailable";
  if (error instanceof PageTooLarge) return "too-large";
  if (error instanceof RobotsDenied) return "robots-denied";
  return "load-failed";
}

export function makeStartCatalog(d: StartCatalogDeps) {
  /** Завести 28 актов стартового каталога (идемпотентно). */
  async function seed(): Promise<void> {
    await seedActs(d.system, START_CATALOG, "start-catalog");
  }

  /** Загрузить оставшиеся акты по одному; ошибка, которая лечится временем, — AppError UNAVAILABLE (повтор задачи). */
  async function run(ctx: {
    signal: AbortSignal;
    progress: (percent: number) => Promise<void>;
  }): Promise<void> {
    await seed();
    const ids = await actsToLoad(d.system, "start-catalog");
    let failed = 0;
    for (const [index, pravoId] of ids.entries()) {
      ctx.signal.throwIfAborted();
      try {
        await d.loadAct(pravoId, ctx.signal);
      } catch (error) {
        if (error instanceof LoaderStopped) {
          await d.notifications.notifyAdmins({
            kind: "law-update-failed",
            key: `loader-stopped:${error.reason}:${d.clock.today()}`,
            params: { reason: error.reason },
          });
          throw new AppError("UNAVAILABLE");
        }
        const act = await findAct(d.system, pravoId);
        if (act !== undefined) {
          await markActState(d.system, act.id, {
            loadState: "failed",
            lastProblem: problemOf(error),
          });
        }
        d.log.warn({ code: problemOf(error) }, "law.start-catalog.act-failed");
        failed += 1;
      }
      await ctx.progress(Math.round(((index + 1) / ids.length) * 100));
    }
    if (failed > 0) throw new AppError("UNAVAILABLE");
  }

  /** Прогресс для экрана первого запуска (LAW-10, LAW-36). */
  async function progress(): Promise<LawsStartupProgress> {
    if (!(await d.settings.get(LEGAL_AUTOLOAD))) {
      return { state: "off", done: 0, total: 0, problems: 0, stopReason: null };
    }
    const { total, loaded, problems } = await countActs(d.system, "start-catalog");
    const base = { done: loaded, total, problems };
    if (total === 0) return { ...base, state: "waiting", stopReason: null };
    if (loaded === total) return { ...base, state: "ready", stopReason: null };
    if ((await d.settings.get(LOADER_CONTACT)).trim() === "") {
      return { ...base, state: "stopped", stopReason: "LOADER_CONTACT_EMPTY" };
    }
    const loader = await d.loader.read();
    if (loader.stoppedOn === d.clock.today() && loader.stopReason !== null) {
      return { ...base, state: "stopped", stopReason: loader.stopReason };
    }
    return { ...base, state: "loading", stopReason: null };
  }

  return { seed, run, progress };
}

export type StartCatalog = ReturnType<typeof makeStartCatalog>;
