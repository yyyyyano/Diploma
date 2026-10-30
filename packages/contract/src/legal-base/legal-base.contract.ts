// Правовая база (LAW-10, AUTH-10): прогресс стартового каталога для экрана первого запуска. Показывается до входа и только
// с этого компьютера (как прогресс моделей); у системной задачи нет домохозяйства — опрос раз в 2 с. Тексты актов и
// публичная «База законов» — T-038.
import { oc } from "@orpc/contract";
import { z } from "zod";
import { pickErrors } from "../errors.ts";

/** Причина остановки загрузчика законов (LAW-36, LAW-38): текст — из словаря i18n по коду. */
export const LoaderStopReason = z.enum([
  "LOADER_CONTACT_EMPTY",
  "LOADER_BLOCKED",
  "LOADER_TOO_MANY_ERRORS",
]);
export type LoaderStopReason = z.infer<typeof LoaderStopReason>;

/**
 * «Загружено 14 из 28 актов» (LAW-10). off — автозагрузка выключена (`legal-base.autoload`); waiting — первый запуск
 * ещё не пройден или каталог не заведён; loading — идёт; ready — все акты загружены; stopped — загрузчик остановлен.
 */
export const LawsStartupProgress = z.strictObject({
  state: z.enum(["off", "waiting", "loading", "ready", "stopped"]),
  done: z.int().min(0),
  total: z.int().min(0),
  /** Акты, которые не удалось загрузить сейчас (карантин, ошибка): загрузка повторится сама. */
  problems: z.int().min(0),
  stopReason: LoaderStopReason.nullable(),
});
export type LawsStartupProgress = z.infer<typeof LawsStartupProgress>;

export const legalBaseContract = {
  startupProgress: oc
    .route({ method: "GET", path: "/legal-base/startup-progress" })
    .output(LawsStartupProgress)
    .errors(pickErrors("NOT_FOUND")),
};
