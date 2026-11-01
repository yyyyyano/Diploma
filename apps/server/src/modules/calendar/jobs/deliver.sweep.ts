// Минутный тик напоминаний (CAL-07, NFR-22): находит владельцев неотправленных напоминаний и ставит каждому задачу. Выключенный
// компьютер ничего не теряет: «срок наступил и не отправлено» проверяется при каждом тике, поэтому пропущенное догоняется
// на первом же тике после запуска.
import { defineSweep } from "../../../platform/jobs/sweep.ts";
import { findReminderOwners } from "../infrastructure/db/calendar.repo.ts";
import type { deliverJob } from "./deliver.job.ts";

export function deliverSweep(job: ReturnType<typeof deliverJob>) {
  return defineSweep({
    name: "calendar.deliver-reminders-sweep",
    cron: "* * * * *",
    find: findReminderOwners,
    job,
    payload: (row) => ({ reminderId: row.id }),
  });
}
