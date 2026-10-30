// Расписание legal-base.daily-check (LAW-30, NFR-22): время — настройка `legal-base.check-time` (по умолчанию 04:00 по поясу системы,
// только внутри ночного окна LAW-35); worker подхватывает смену времени без перезапуска (`liveCron`). Пропущенное (компьютер был
// выключен) догоняется платформой при включении — `missed: "once"`. Автообновление выключено — плановый проход ничего не делает.
import type { Settings } from "../../../platform/settings/settings.ts";
import { defineSchedule } from "../../../platform/jobs/schedule.ts";
import type { DailyCheck } from "../application/daily-check.ts";
import { dailyCron } from "../domain/schedule.ts";
import { AUTO_UPDATE, CHECK_TIME } from "../settings.ts";

export function dailyCheckSchedule(check: DailyCheck, settings: Pick<Settings, "get">) {
  return defineSchedule({
    name: "legal-base.daily-check",
    cron: dailyCron(CHECK_TIME.default),
    liveCron: async () => dailyCron(await settings.get(CHECK_TIME)),
    stepDays: 1,
    handle: async (ctx) => {
      if (!(await settings.get(AUTO_UPDATE))) return;
      await check(ctx.signal);
    },
  });
}
