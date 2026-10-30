// REC-05: ежедневный обход ставит каждому найденному платежу проверку; в нагрузке — только id платежа.
import { describe, expect, it } from "vitest";
import { checkMissedJob } from "./check-missed.job.ts";
import { checkMissedSweep } from "./check-missed.sweep.ts";

describe("REC-05: ежедневный обход «возможно прекращён»", () => {
  const job = checkMissedJob(async () => false);
  const sweep = checkMissedSweep(job);

  it("имя и расписание — ночью, раз в сутки; задача — recurring.check-missed", () => {
    expect(sweep.name).toBe("recurring.check-missed-sweep");
    expect(sweep.cron).toBe("10 4 * * *");
    expect(sweep.job.name).toBe("recurring.check-missed");
  });

  it("нагрузка — только id платежа из найденной строки", () => {
    const row = { id: "0199f0a0-0000-7000-8000-000000000001", householdId: "h", userId: "u" };
    expect(sweep.payload(row)).toEqual({ itemId: row.id });
  });

  it("задача отвергает нагрузку не по схеме (не uuid)", () => {
    expect(job.payload.safeParse({ itemId: "не uuid" }).success).toBe(false);
  });
});
