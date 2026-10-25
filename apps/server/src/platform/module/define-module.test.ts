// ARCHITECTURE §4.3, §5: модуль описывает себя defineModule — всё, кроме id, необязательно; корень композиции
// раскладывает части по реестрам. Имена задач, событий, расписаний, обходов и действий начинаются с id модуля.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineEvent } from "../events/define-event.ts";
import { defineSubscription } from "../events/define-subscription.ts";
import { defineJob } from "../jobs/define-job.ts";
import { defineSchedule } from "../jobs/schedule.ts";
import { defineModule } from "./define-module.ts";

const noop = async () => {};

describe("defineModule: пустой, но живой модуль", () => {
  it("только id — без фасада, роутера и записей в реестрах", () => {
    expect(defineModule({ id: "fx-rates" })).toEqual({
      id: "fx-rates",
      facade: undefined,
      router: undefined,
      events: [],
      jobs: [],
      subscriptions: [],
      schedules: [],
      sweeps: [],
      tools: [],
      deliveryChannels: [],
      undo: {},
      confirm: {},
      userData: undefined,
      settings: [],
      secrets: [],
      rateRules: [],
    });
  });

  it("фасад модуля сохраняет свой тип для соседей", () => {
    const module = defineModule({ id: "accounts", facade: { count: () => 1 } });
    expect(module.facade.count()).toBe(1);
  });

  it("id — kebab-case латиницей, как в modules.ts", () => {
    expect(() => defineModule({ id: "FxRates" })).toThrow(/kebab-case/);
  });
});

describe("имена частей начинаются с id модуля", () => {
  it("задача чужого модуля — ошибка с её именем", () => {
    const job = defineJob({ name: "receipts.recognize", payload: z.object({}), handle: noop });
    expect(() => defineModule({ id: "statements", jobs: [job] })).toThrow(/receipts\.recognize/);
  });

  it("событие и расписание своего модуля принимаются", () => {
    const event = defineEvent({
      name: "receipts.recognized",
      payload: z.object({ ids: z.array(z.string()) }),
    });
    const schedule = defineSchedule({
      name: "receipts.stuck",
      cron: "0 3 * * *",
      stepDays: 1,
      handle: noop,
    });
    const module = defineModule({ id: "receipts", events: [event], schedules: [schedule] });
    expect(module.events.map((e) => e.name)).toEqual(["receipts.recognized"]);
    expect(module.schedules.map((s) => s.name)).toEqual(["receipts.stuck"]);
  });

  it("подписка, объявленная для другого модуля, — ошибка", () => {
    const event = defineEvent({
      name: "transactions.changed",
      payload: z.object({ ids: z.array(z.string()) }),
    });
    const subscription = defineSubscription({ event, module: "budgets", handle: noop });
    expect(() => defineModule({ id: "recurring", subscriptions: [subscription] })).toThrow(
      /evt\.transactions\.changed\.budgets/,
    );
  });

  it("обработчики отмены и подтверждения — `<модуль>.<действие>`", () => {
    expect(() => defineModule({ id: "budgets", undo: { "goals.delete": noop } })).toThrow(
      /goals\.delete/,
    );
    expect(() => defineModule({ id: "budgets", confirm: { budgets: noop } })).toThrow(/budgets/);
    expect(
      defineModule({ id: "budgets", confirm: { "budgets.delete-goal": noop } }).confirm,
    ).toHaveProperty("budgets.delete-goal");
  });
});
