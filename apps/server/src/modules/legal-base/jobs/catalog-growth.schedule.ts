// Расписание legal-base.catalog-growth (LAW-11…17, LAW-35): ночной проход пополнения каталога — через полчаса после ежедневной
// проверки (`legal-base.check-time`), внутри ночного окна. Пропущенные дни «Новых поступлений» читает сам проход по своей отметке
// (≤ 30 дней, LAW-12), поэтому после простоя `missed: "once"` достаточно одного запуска. Автообновление выключено — проход пуст.
import type { Settings } from "../../../platform/settings/settings.ts";
import { defineSchedule } from "../../../platform/jobs/schedule.ts";
import type { CatalogGrowth } from "../application/catalog-growth.ts";
import { dailyCron, GROWTH_OFFSET_MIN } from "../domain/schedule.ts";
import { AUTO_UPDATE, CHECK_TIME } from "../settings.ts";

export function catalogGrowthSchedule(
  growth: Pick<CatalogGrowth, "run">,
  settings: Pick<Settings, "get">,
) {
  return defineSchedule({
    name: "legal-base.catalog-growth",
    cron: dailyCron(CHECK_TIME.default, GROWTH_OFFSET_MIN),
    liveCron: async () => dailyCron(await settings.get(CHECK_TIME), GROWTH_OFFSET_MIN),
    stepDays: 1,
    handle: async () => {
      if (!(await settings.get(AUTO_UPDATE))) return;
      await growth.run();
    },
  });
}
