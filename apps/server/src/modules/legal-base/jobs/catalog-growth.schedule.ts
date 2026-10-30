// Расписание legal-base.catalog-growth (LAW-11…17, LAW-35): ночной проход пополнения каталога — через полчаса после ежедневной
// проверки, внутри ночного окна. Пропущенные дни «Новых поступлений» читает сам проход по своей отметке (≤ 30 дней, LAW-12),
// поэтому после простоя `missed: "once"` достаточно одного запуска. Время и окно — в админке, T-039.
import { defineSchedule } from "../../../platform/jobs/schedule.ts";
import type { CatalogGrowth } from "../application/catalog-growth.ts";

export function catalogGrowthSchedule(growth: Pick<CatalogGrowth, "run">) {
  return defineSchedule({
    name: "legal-base.catalog-growth",
    cron: "30 4 * * *",
    stepDays: 1,
    handle: async () => {
      await growth.run();
    },
  });
}
