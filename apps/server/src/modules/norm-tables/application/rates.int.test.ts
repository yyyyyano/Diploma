// TAX-03, ADM-11, LEGAL-08, LAW-33 на Postgres: начальное наполнение (значения, сверенные с НК, подтверждены разработчиком, остальные
// ждут «Подтвердить»); калькулятор получает только подтверждённое или явное «нет данных»; правка — новая версия, вступает в силу после
// «Подтвердить»; история остаётся.
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb } from "../../../platform/db/scoped-db.ts";
import { createSystemDb, type SystemDb } from "../../../platform/db/system-db.ts";
import { RATE_PARAMS } from "../domain/params.ts";
import { SEED_RATES } from "../domain/seed-values.ts";
import { makeRates } from "./rates.ts";

let db: TestDb;
let system: SystemDb;
const published: string[][] = [];
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
    clock,
    publishConfirmed: async (_tx, ids) => {
      published.push([...ids]);
    },
  });
const adminScope = () => createScopedDb(db.pool, testScope({ user: 1, household: 1 }));
const rowsOf = async (param: string) =>
  (await rates().table()).items.filter((r) => r.param === param);
const ids = async (param: string, status: string) =>
  (await rowsOf(param)).filter((r) => r.status === status).map((r) => r.id);

describe("TAX-03: начальное наполнение — умолчания кода кладёт миграция", () => {
  it("по строке на каждый параметр реестра на 2026 год, значения совпадают с seed", async () => {
    const { items } = await rates().table();
    expect(items.map((r) => r.param).toSorted()).toEqual(
      RATE_PARAMS.map((p) => p.param).toSorted(),
    );
    for (const seed of SEED_RATES) {
      expect(items.find((r) => r.param === seed.param)).toMatchObject({
        value: seed.value,
        validFrom: "2026-01-01",
        validTo: "2026-12-31",
        status: seed.verified ? "confirmed" : "pending",
      });
    }
  });

  it("вычеты ст. 209 и ставки ст. 214, 381² подтверждены разработчиком в день сверки; взнос ФСЗН и ПДН ждут «Подтвердить»", async () => {
    const { items, counts } = await rates().table();
    const base = items.find((r) => r.param === "ndfl.std-deduction.base");
    expect(base).toMatchObject({
      status: "confirmed",
      confirmed: { by: "developer", on: "2026-10-30" },
      source: { act: "Hk0900071", article: "209", point: "1.1" },
    });
    expect(items.find((r) => r.param === "ndfl.rate.base")).toMatchObject({
      status: "confirmed",
      confirmed: { by: "developer", on: "2026-11-01" },
      source: { act: "Hk0900071", article: "214", point: "1.1" },
    });
    expect(items.find((r) => r.param === "npd.rate.base")).toMatchObject({
      status: "confirmed",
      source: { act: "Hk0900071", article: "381²", point: "1" },
    });
    expect(items.find((r) => r.param === "fszn.employee-rate")).toMatchObject({
      status: "pending",
      value: 100,
      confirmed: null,
    });
    expect(items.find((r) => r.param === "pdn.limit.default")?.source.url).toContain("nbrb.by");
    expect(counts.pending).toBe(SEED_RATES.filter((r) => !r.verified).length);
  });
});

describe("TAX-03, LEGAL-08: ответ калькулятору — только подтверждённое", () => {
  it("подтверждённое значение на день — с источником и тем, кто подтвердил", async () => {
    expect(await rates().value("ndfl.std-deduction.child", "2026-05-17")).toMatchObject({
      found: true,
      value: 6300,
      unit: "byn-minor",
      source: { act: "Hk0900071", article: "209", point: "1.2" },
      confirmedBy: "developer",
      confirmedOn: "2026-10-30",
      // Акт ещё не проиндексирован (сверки LAW-33 не было) — версии фрагмента нет; после сверки она в ответе (main/admin-rates).
      versionId: null,
    });
  });

  it("на год без значения — явное «нет данных»; значение ждёт подтверждения — «не подтверждено», а не число", async () => {
    expect(await rates().value("ndfl.std-deduction.child", "2025-06-01")).toEqual({
      found: false,
      reason: "no-data",
    });
    expect(await rates().value("fszn.employee-rate", "2026-06-01")).toEqual({
      found: false,
      reason: "unconfirmed",
    });
    expect(await rates().value("нет.такого", "2026-06-01")).toEqual({
      found: false,
      reason: "no-data",
    });
  });
});

describe("ADM-11: правка и подтверждение", () => {
  it("значение за прошлый год: предложено — в силу не вступает, после «Подтвердить» — отвечает, событие уходит", async () => {
    const proposed = await rates().propose({
      param: "ndfl.std-deduction.child",
      validFrom: "2025-01-01",
      validTo: "2025-12-31",
      value: 5000,
      sourceAct: "Hk0900071",
      sourceArticle: "209",
      sourcePoint: "1.2",
      sourceUrl: null,
    });
    const id = proposed.items.find(
      (r) => r.param === "ndfl.std-deduction.child" && r.validFrom === "2025-01-01",
    )?.id;
    expect(id).toBeDefined();
    expect(await rates().value("ndfl.std-deduction.child", "2025-06-01")).toEqual({
      found: false,
      reason: "unconfirmed",
    });
    await rates().confirm(adminScope(), id ?? "");
    expect(await rates().value("ndfl.std-deduction.child", "2025-06-01")).toMatchObject({
      found: true,
      value: 5000,
      confirmedBy: "admin",
      confirmedOn: "2026-11-02",
    });
    expect(published).toEqual([[id]]);
  });

  it("событие не опубликовалось — подтверждение откатывается: значение по-прежнему ждёт «Подтвердить»", async () => {
    await rates().propose({
      param: "ndfl.std-deduction.child",
      validFrom: "2024-01-01",
      validTo: "2024-12-31",
      value: 4000,
      sourceAct: "Hk0900071",
      sourceArticle: "209",
      sourcePoint: "1.2",
      sourceUrl: null,
    });
    const [id] = await ids("ndfl.std-deduction.child", "pending");
    const failing = makeRates({
      system,
      clock,
      publishConfirmed: async () => {
        throw new Error("outbox down");
      },
    });
    await expect(failing.confirm(adminScope(), id ?? "")).rejects.toThrow("outbox down");
    expect(await ids("ndfl.std-deduction.child", "pending")).toContain(id);
    expect(await rates().value("ndfl.std-deduction.child", "2024-06-01")).toEqual({
      found: false,
      reason: "unconfirmed",
    });
  });

  it("изменение подтверждённого значения: новая версия ждёт, старая действует; после «Подтвердить» старая — в истории", async () => {
    const [oldId] = await ids("ndfl.std-deduction.disabled", "confirmed");
    await rates().propose({
      param: "ndfl.std-deduction.disabled",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      value: 31_000,
      sourceAct: "Hk0900071",
      sourceArticle: "209",
      sourcePoint: "1.3",
      sourceUrl: null,
    });
    expect(await rates().value("ndfl.std-deduction.disabled", "2026-03-01")).toMatchObject({
      found: true,
      value: 30_600,
    });
    const [newId] = await ids("ndfl.std-deduction.disabled", "pending");
    await rates().confirm(adminScope(), newId ?? "");
    expect(await rates().value("ndfl.std-deduction.disabled", "2026-03-01")).toMatchObject({
      value: 31_000,
      confirmedBy: "admin",
    });
    const history = await rowsOf("ndfl.std-deduction.disabled");
    expect(history.map((r) => [r.id === oldId ? "old" : "new", r.status])).toEqual([
      ["old", "superseded"],
      ["new", "confirmed"],
    ]);
  });

  it("повторное предложение на тот же период правит ожидающее значение, а не плодит строки", async () => {
    const input = {
      param: "ndfl.rate.base",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      value: 1300,
      sourceAct: "Hk0900071",
      sourceArticle: "214",
      sourcePoint: null,
      sourceUrl: null,
    };
    await rates().propose({ ...input, value: 1400 });
    await rates().propose(input);
    const pending = (await rowsOf("ndfl.rate.base")).filter((r) => r.status === "pending");
    expect(pending.map((r) => r.value)).toEqual([1300]);
  });

  it("пересекающийся период другого начала не подтверждается — CONFLICT; «Отклонить» убирает значение из таблицы", async () => {
    await rates().propose({
      param: "ndfl.std-deduction.young-specialist",
      validFrom: "2026-07-01",
      validTo: null,
      value: 90_000,
      sourceAct: null,
      sourceArticle: null,
      sourcePoint: null,
      sourceUrl: "https://example.test/norma",
    });
    const [id] = await ids("ndfl.std-deduction.young-specialist", "pending");
    await expect(rates().confirm(adminScope(), id ?? "")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await rates().reject(id ?? "");
    expect(await ids("ndfl.std-deduction.young-specialist", "pending")).toEqual([]);
    await expect(rates().reject(id ?? "")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(rates().confirm(adminScope(), id ?? "")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("неизвестный параметр, перевёрнутый период, нет источника, не номер статьи — VALIDATION с полем", async () => {
    const base = {
      param: "ndfl.rate.base",
      validFrom: "2027-01-01",
      validTo: null,
      value: 1,
      sourceAct: "Hk0900071",
      sourceArticle: "214",
      sourcePoint: null,
      sourceUrl: null,
    };
    const field = async (patch: object) =>
      rates()
        .propose({ ...base, ...patch })
        .then(
          () => "принято",
          (error: { code: string; params: { field?: string } }) => [error.code, error.params.field],
        );
    expect(await field({ param: "x.y" })).toEqual(["VALIDATION", "param"]);
    expect(await field({ validTo: "2026-12-31" })).toEqual(["VALIDATION", "validTo"]);
    expect(await field({ sourceAct: null, sourceArticle: null })).toEqual(["VALIDATION", "source"]);
    expect(await field({ sourceArticle: "ПДН" })).toEqual(["VALIDATION", "sourceArticle"]);
  });
});
