// Обход итогов недели (WEEK-01, WEEK-03, NFR-22): раз в 15 минут находит активных пользователей и ставит каждому задачу; день и
// время пользователя сверяет сама задача. Пропущенное при выключенном компьютере догоняется на первом же обходе после запуска.
// Владельцев даёт identity (у неё строка каждого пользователя): пользователь без строки `weekly_preferences` — зарегистрированный
// до T-050 и не открывавший главную — считается умолчанием и попадает в обход без миграции досоздания.
import { defineSweep } from "../../../platform/jobs/sweep.ts";
import type { IdentityFacade } from "../../identity/index.ts";
import type { buildJob } from "./build.job.ts";

export function buildSweep(
  job: ReturnType<typeof buildJob>,
  identity: Pick<IdentityFacade, "activeOwners">,
) {
  return defineSweep({
    name: "weekly.build-summary-sweep",
    cron: "*/15 * * * *",
    find: (db) => identity.activeOwners(db),
    job,
    payload: () => ({}),
  });
}
