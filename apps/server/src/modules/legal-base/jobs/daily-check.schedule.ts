// Расписание legal-base.daily-check (LAW-30, NFR-22): 04:00 по поясу системы, внутри ночного окна 02:00–06:00 (LAW-35);
// пропущенное (компьютер был выключен) догоняется платформой при включении — `missed: "once"`. Время и окно в админке — T-039.
import { defineSchedule } from "../../../platform/jobs/schedule.ts";
import type { DailyCheck } from "../application/daily-check.ts";

export function dailyCheckSchedule(check: DailyCheck) {
  return defineSchedule({
    name: "legal-base.daily-check",
    cron: "0 4 * * *",
    stepDays: 1,
    handle: async (ctx) => {
      await check(ctx.signal);
    },
  });
}
