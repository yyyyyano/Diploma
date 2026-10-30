// Ежедневный обход «возможно прекращён» (REC-05): находит действующие найденные платежи и ставит каждому проверку; дату
// сверяет сама задача. Расписание — cron по поясу clock.time-zone, после простоя — один запуск (missed: "once").
import { defineSweep } from "../../../platform/jobs/sweep.ts";
import { findActiveDetected } from "../infrastructure/db/recurring.repo.ts";
import type { checkMissedJob } from "./check-missed.job.ts";

export function checkMissedSweep(job: ReturnType<typeof checkMissedJob>) {
  return defineSweep({
    name: "recurring.check-missed-sweep",
    cron: "10 4 * * *",
    find: findActiveDetected,
    job,
    payload: (row) => ({ itemId: row.id }),
  });
}
