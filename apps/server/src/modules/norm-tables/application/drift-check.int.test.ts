// LAW-33 на Postgres: после новой редакции закона число подтверждённой ставки ищется в действующем тексте пункта; нет числа — пометка
// и уведомление администратору, значение само не меняется; число вернулось или значение подтвердил человек — пометка снимается.
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import { createSystemDb, type SystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import { makeDriftCheck } from "./drift-check.ts";
import { makeRates } from "./rates.ts";

let db: TestDb;
let system: SystemDb;
const clock = new FakeClock("2026-11-02T09:00:00Z");
beforeAll(async () => {
  db = await createTestDb();
  system = createSystemDb(db.pool);
});
afterAll(async () => {
  await db.drop();
});

const rates = () =>
  makeRates({
    system,
    legalBase: { fragmentsUnder: async () => [] },
    clock,
    publishConfirmed: async () => {},
  });
const adminScope = () => createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
const ids = async (param: string, status: string) =>
  (await rates().table()).items
    .filter((r) => r.param === param && r.status === status)
    .map((r) => r.id);

describe("LAW-33: сверка с новой редакцией закона", () => {
  const notified: { kind: string; key: string }[] = [];
  function check(texts: Record<string, string[]>) {
    return makeDriftCheck({
      system,
      legalBase: {
        fragmentsUnder: async (_act, path) =>
          (texts[path] ?? []).map((text, i) => ({
            versionId: `00000000-0000-7000-8000-00000000000${String(i)}`,
            pathKey: path,
            text,
          })),
      },
      notifications: {
        notifyAdmins: async (i: { kind: string; key: string }) => {
          notified.push({ kind: i.kind, key: i.key });
          return undefined;
        },
      } as never,
      clock,
      log: memoryLogger().log,
    });
  }
  const unchanged = {
    "a209/p1.1": ["1.1. в размере 216 белорусских рублей при доходе до 1 308 белорусских рублей"],
    "a209/p1.2": ["1.2. в размере 63 рублей", "в размере 120 рублей на каждого ребенка"],
    "a209/p1.3": ["1.3. в размере 306 рублей"],
    "a209/p1.4": ["1.4. в размере 860 рублей"],
  };

  it("число на месте — пометки нет, версия фрагмента запоминается", async () => {
    await check(unchanged)();
    const { items } = await rates().table();
    const base = items.find(
      (r) => r.param === "ndfl.std-deduction.base" && r.status === "confirmed",
    );
    expect(base).toMatchObject({ drift: false, source: { linked: true } });
    expect(notified).toEqual([]);
  });

  it("в изменённом фрагменте другое число — пометка и одно уведомление администратору, значение само не меняется", async () => {
    const changed = {
      ...unchanged,
      "a209/p1.1": ["1.1. в размере 230 белорусских рублей при доходе до 1 308 белорусских рублей"],
    };
    const result = await check(changed)();
    expect(result.drifted).toBe(1);
    await check(changed)();
    // Ключ один и тот же: настоящий `notifyAdmins` идемпотентен по виду и ключу, второго уведомления не будет.
    expect(notified.map((n) => n.kind)).toEqual(["rates-mismatch", "rates-mismatch"]);
    expect(new Set(notified.map((n) => n.key)).size).toBe(1);
    const base = (await rates().table()).items.find(
      (r) => r.param === "ndfl.std-deduction.base" && r.status === "confirmed",
    );
    expect(base).toMatchObject({ drift: true, value: 21_600 });
    expect(await rates().value("ndfl.std-deduction.base", "2026-06-01")).toMatchObject({
      value: 21_600,
    });
  });

  it("число вернулось в текст — пометка снимается; у акта без текста сверять нечего и пометки нет", async () => {
    await check(unchanged)();
    const table = (await rates().table()).items;
    expect(table.filter((r) => r.drift)).toEqual([]);
    expect((await check({})()).checked).toBe(0);
  });

  it("«Подтвердить» новое значение снимает пометку расхождения", async () => {
    const changed = {
      ...unchanged,
      "a209/p1.1": ["1.1. в размере 230 рублей при доходе до 1 308 рублей"],
    };
    await check(changed)();
    await rates().propose({
      param: "ndfl.std-deduction.base",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      value: 23_000,
      sourceAct: "Hk0900071",
      sourceArticle: "209",
      sourcePoint: "1.1",
      sourceUrl: null,
    });
    const [id] = await ids("ndfl.std-deduction.base", "pending");
    await rates().confirm(adminScope(), id ?? "");
    const row = (await rates().table()).items.find(
      (r) => r.param === "ndfl.std-deduction.base" && r.status === "confirmed",
    );
    expect(row).toMatchObject({ value: 23_000, drift: false });
  });

  it("значение прошлого года в сверке не участвует: текст нормы сегодня отвечает за числа сегодняшнего периода", async () => {
    const baseline = (await check(unchanged)()).drifted;
    await rates().propose({
      param: "ndfl.std-deduction.child",
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
      value: 5800,
      sourceAct: "Hk0900071",
      sourceArticle: "209",
      sourcePoint: "1.2",
      sourceUrl: null,
    });
    const [id] = await ids("ndfl.std-deduction.child", "pending");
    await rates().confirm(adminScope(), id ?? "");
    expect((await check(unchanged)()).drifted).toBe(baseline);
  });
});
