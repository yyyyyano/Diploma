// Ежедневный обход целей (BUD-07): находит владельцев целей и ставит каждой цели проверку; «отстаёт» ли, решает задача по
// часам. Расписание — cron по поясу clock.time-zone, после простоя — один запуск (missed: "once").
import { defineSweep } from "../../../platform/jobs/sweep.ts";
import { findGoalOwners } from "../infrastructure/db/budgets.repo.ts";
import type { checkGoalJob } from "./check-goal.job.ts";

export function checkGoalSweep(job: ReturnType<typeof checkGoalJob>) {
  return defineSweep({
    name: "budgets.check-goals-sweep",
    cron: "30 4 * * *",
    find: findGoalOwners,
    job,
    payload: (row) => ({ goalId: row.id }),
  });
}
