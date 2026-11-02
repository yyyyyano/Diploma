// DEMO-03, DEMO-04: порядок работы с демо-пользователем без БД — «создать, если нет» не пишет историю дважды (ни в одном процессе,
// ни при гонке двух), пересоздание сначала очищает, потом пишет, согласие на облако выдаётся заново, упавшая запись перезапускается.
// Генерация, identity, privacy и weekly — двойники: сами данные проверяет сквозной тест main/demo.int.test.ts.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { describe, expect, it } from "vitest";
import { AppError } from "../../../platform/errors/app-error.ts";
import { makeDemo } from "./demo.ts";
import type { GenerateReport } from "./generate.ts";

const REPORT: GenerateReport = { operations: 10, receipts: 5, limits: 4, goals: 2, weeks: 8 };

function setup(
  options: {
    complete?: boolean;
    started?: boolean;
    generate?: () => Promise<GenerateReport>;
    completesAfter?: number;
  } = {},
) {
  const calls: string[] = [];
  const state = { complete: options.complete ?? false, polls: 0 };
  const s = {
    scope: { userId: "u", householdId: "h" },
    transaction: async (fn: (tx: unknown) => unknown) => fn({}),
  };
  const demo = makeDemo({
    platform: {
      log: { info() {}, warn() {}, error() {}, debug() {}, fatal() {} },
      jobs: {
        discardHousehold: async () => {
          calls.push("discard");
          return 0;
        },
      },
      scoped: () => s,
    } as never,
    identity: { ensureDemoUser: async () => ({ scope: s.scope, created: false }) } as never,
    privacy: {
      purge: async () => {
        calls.push("purge");
        state.complete = false;
      },
      recordRegistrationConsents: async (_tx: unknown, consents: unknown) => {
        calls.push(`consents:${JSON.stringify(consents)}`);
      },
    } as never,
    weekly: {
      history: async () => {
        state.polls += 1;
        if (options.completesAfter !== undefined && state.polls > options.completesAfter) {
          state.complete = true;
        }
        return state.complete ? [{}] : [];
      },
    } as never,
    accounts: { findCard: async () => (options.started === true ? {} : undefined) } as never,
    generate: (async () => {
      calls.push("generate");
      // Готово — только после успешной записи: упавшая на полпути оставляет «не готово».
      const report = await (options.generate ?? (async () => REPORT))();
      state.complete = true;
      return report;
    }) as never,
    sleep: async () => {},
    waitPolls: 3,
  });
  return { demo, calls, state };
}

describe("DEMO-04: создать, если нет", () => {
  it("демо готово — историю не пишут", async () => {
    const { demo, calls } = setup({ complete: true });
    expect(await demo.ensure()).toEqual({ report: undefined });
    expect(calls).toEqual([]);
  });

  it("демо нет — история пишется один раз, ответ несёт числа записанного", async () => {
    const { demo, calls } = setup();
    expect(await demo.ensure()).toEqual({ report: REPORT });
    expect(calls).toEqual(["generate"]);
  });

  it("два вызова разом в одном процессе пишут историю один раз", async () => {
    const { demo, calls } = setup();
    await Promise.all([demo.ensure(), demo.ensure(), demo.ensure()]);
    expect(calls).toEqual(["generate"]);
  });

  it("запись уже начата другим процессом и завершится — ждём, сами не пишем", async () => {
    const { demo, calls } = setup({ started: true, completesAfter: 2 });
    expect(await demo.ensure()).toEqual({ report: undefined });
    expect(calls).toEqual([]);
  });

  it("запись начата, но так и не завершилась (процесс упал) — чистим и пишем заново, согласие выдано заново", async () => {
    const { demo, calls } = setup({ started: true });
    expect(await demo.ensure()).toEqual({ report: REPORT });
    expect(calls).toEqual([
      "discard",
      "purge",
      `consents:${JSON.stringify({
        personalData: { accepted: true, version: CONSENT_VERSIONS.personalData },
        cloud: { accepted: true, version: CONSENT_VERSIONS.cloud },
      })}`,
      "generate",
    ]);
  });

  it("гонка за первую карту: CONFLICT от соседа — ждём его готовности, ошибки нет", async () => {
    const { demo } = setup({
      completesAfter: 1,
      generate: async () => {
        throw new AppError("CONFLICT");
      },
    });
    expect(await demo.ensure()).toEqual({ report: undefined });
  });

  it("любая другая ошибка записи не глотается", async () => {
    const { demo } = setup({
      generate: async () => {
        throw new AppError("INTERNAL");
      },
    });
    await expect(demo.ensure()).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("после сбоя очередь не застревает: следующий вызов выполняется", async () => {
    let first = true;
    const { demo, calls } = setup({
      generate: async () => {
        if (first) {
          first = false;
          throw new AppError("INTERNAL");
        }
        return REPORT;
      },
    });
    await expect(demo.ensure()).rejects.toMatchObject({ code: "INTERNAL" });
    expect(await demo.ensure()).toEqual({ report: REPORT });
    expect(calls).toEqual(["generate", "generate"]);
  });
});

describe("DEMO-03: пересоздать", () => {
  it("сначала очищает (задачи, данные, согласие заново), потом пишет — и даже на готовом демо", async () => {
    const { demo, calls } = setup({ complete: true });
    expect(await demo.recreate()).toEqual(REPORT);
    expect(calls.map((call) => call.split(":")[0])).toEqual([
      "discard",
      "purge",
      "consents",
      "generate",
    ]);
  });
});
