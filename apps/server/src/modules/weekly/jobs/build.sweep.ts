// Обход итогов недели (WEEK-01, WEEK-03, NFR-22): раз в 15 минут находит владельцев включённых сводок и ставит каждому задачу;
// день и время пользователя сверяет сама задача. Пропущенное при выключенном компьютере догоняется на первом же обходе после запуска.
import { defineSweep } from "../../../platform/jobs/sweep.ts";
import { findOwners } from "../infrastructure/db/weekly.repo.ts";
import type { buildJob } from "./build.job.ts";

export function buildSweep(job: ReturnType<typeof buildJob>) {
  return defineSweep({
    name: "weekly.build-summary-sweep",
    cron: "*/15 * * * *",
    find: findOwners,
    job,
    payload: (row) => ({ preferenceId: row.id }),
  });
}
