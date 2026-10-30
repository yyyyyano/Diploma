// Ночной обход «брошенных черновиков» импорта: находит владельцев черновиков (предпросмотр или ошибка разбора), не
// тронутых больше суток, и ставит каждому задачу statements.discard-draft; возраст по настройке TTL проверяет задача.
import { defineSweep } from "../../../platform/jobs/sweep.ts";
import { findStaleDraftOwners } from "../infrastructure/db/statement-imports.repo.ts";
import type { discardDraftJob } from "./discard-draft.job.ts";

export function discardDraftsSweep(job: ReturnType<typeof discardDraftJob>) {
  return defineSweep({
    name: "statements.discard-drafts",
    cron: "30 3 * * *",
    find: findStaleDraftOwners,
    job,
    payload: (row) => ({ importId: row.id }),
  });
}
