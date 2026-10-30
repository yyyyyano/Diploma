// LAW-30, LAW-35: время плановых проходов — из настроек, выключатель автообновления гасит оба.
import { describe, expect, it } from "vitest";
import type { SettingDef } from "../../../platform/settings/settings.ts";
import { catalogGrowthSchedule } from "./catalog-growth.schedule.ts";
import { dailyCheckSchedule } from "./daily-check.schedule.ts";
import { AUTO_UPDATE, CHECK_TIME } from "../settings.ts";

function settings(values: { checkTime?: string; auto?: boolean }) {
  return {
    get: async <T>(def: SettingDef<T>): Promise<T> => {
      if (def.key === CHECK_TIME.key) return (values.checkTime ?? CHECK_TIME.default) as T;
      if (def.key === AUTO_UPDATE.key) return (values.auto ?? true) as T;
      throw new Error(`лишняя настройка ${def.key}`);
    },
  };
}

const ctx = { requestId: "r", log: {} as never, signal: new AbortController().signal };

describe("LAW-30: расписание ежедневной проверки", () => {
  it("по умолчанию 04:00, а время из настройки превращается в cron на лету", async () => {
    const schedule = dailyCheckSchedule(
      async () => ({}) as never,
      settings({ checkTime: "03:15" }),
    );
    expect(schedule.cron).toBe("0 4 * * *");
    expect(await schedule.liveCron?.()).toBe("15 3 * * *");
  });

  it("автообновление выключено — проверка не запускается, включено — запускается", async () => {
    let runs = 0;
    const check = async () => {
      runs += 1;
      return {} as never;
    };
    await dailyCheckSchedule(check, settings({ auto: false })).handle(ctx, []);
    expect(runs).toBe(0);
    await dailyCheckSchedule(check, settings({ auto: true })).handle(ctx, []);
    expect(runs).toBe(1);
  });
});

describe("LAW-35: пополнение каталога идёт через 30 минут после проверки", () => {
  it("время проверки 03:45 — проход пополнения в 04:15; при выключенном автообновлении проход пуст", async () => {
    let runs = 0;
    const growth = {
      run: async () => {
        runs += 1;
        return {} as never;
      },
    };
    const on = catalogGrowthSchedule(growth, settings({ checkTime: "03:45" }));
    expect(on.cron).toBe("30 4 * * *");
    expect(await on.liveCron?.()).toBe("15 4 * * *");
    await catalogGrowthSchedule(growth, settings({ auto: false })).handle(ctx, []);
    expect(runs).toBe(0);
    await on.handle(ctx, []);
    expect(runs).toBe(1);
  });
});
