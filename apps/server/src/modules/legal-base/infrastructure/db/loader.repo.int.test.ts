// LAW-35, LAW-38 на настоящем Postgres: очередь слотов под advisory-lock (пауза общая и переживает «перезапуск» —
// новый экземпляр на той же базе), остановка цикла, кэш robots.txt, журнал запросов и счётчики по дням.
import { LocalDate } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../../platform/db/system-db.ts";
import { makeLoaderStore } from "./loader.repo.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const store = () => makeLoaderStore(createSystemDb(db.pool));
const day = (text: string) => LocalDate.parse(text);
const T0 = new Date("2026-10-30T09:00:00Z");

describe("LAW-35: очередь запросов к pravo.by", () => {
  it("слоты идут с паузой, в том числе у нового экземпляра после перезапуска", async () => {
    const first = await store().reserveSlot(T0, 4000);
    expect(first.getTime()).toBe(T0.getTime());
    // «Перезапуск»: другой экземпляр, то же состояние в БД.
    const second = await store().reserveSlot(new Date(T0.getTime() + 1000), 3000);
    expect(second.getTime()).toBe(T0.getTime() + 4000);
    const third = await store().reserveSlot(new Date(T0.getTime() + 60_000), 3000);
    expect(third.getTime()).toBe(T0.getTime() + 60_000);
  });

  it("пять одновременных запросов получают разные слоты, разнесённые не меньше паузы", async () => {
    const base = new Date("2026-10-31T09:00:00Z");
    const slots = await Promise.all(
      Array.from({ length: 5 }, () => store().reserveSlot(base, 3000)),
    );
    const sorted = slots.map((s) => s.getTime()).sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]! - sorted[i - 1]!).toBeGreaterThanOrEqual(3000);
    }
  });
});

describe("LAW-38: состояние цикла", () => {
  it("остановка помнится в БД и снимается", async () => {
    await store().stop(day("2026-11-02"), "LOADER_BLOCKED");
    expect(await store().read()).toMatchObject({
      stoppedOn: "2026-11-02",
      stopReason: "LOADER_BLOCKED",
    });
    await store().resume();
    expect(await store().read()).toMatchObject({ stoppedOn: null, stopReason: null });
  });

  it("счётчики цикла считают запросы и ошибки дня, а в новый день начинаются с нуля", async () => {
    const entry = (isError: boolean, outcome = isError ? "http-5xx" : "ok") => ({
      at: T0,
      url: "/document/?p0=H10200090",
      httpStatus: isError ? 503 : 200,
      bytes: 10,
      ms: 5,
      outcome,
      isError,
    });
    await store().record(entry(false), day("2026-11-03"));
    const afterError = await store().record(entry(true), day("2026-11-03"));
    expect(afterError).toEqual({ requests: 2, errors: 1 });
    const denied = await store().record(entry(false, "robots-denied"), day("2026-11-03"));
    expect(denied).toEqual({ requests: 2, errors: 1 });
    const nextDay = await store().record(entry(false), day("2026-11-04"));
    expect(nextDay).toEqual({ requests: 1, errors: 0 });
  });

  it("robots.txt сохраняется вместе с моментом загрузки", async () => {
    await store().saveRobots("User-agent: *\nDisallow: /bitrix/\n", T0);
    const state = await store().read();
    expect(state.robotsTxt).toContain("Disallow: /bitrix/");
    expect(state.robotsFetchedAt?.getTime()).toBe(T0.getTime());
  });
});

describe("LAW-15: ведомственные сайты — пауза, остановка и robots отдельно на хост", () => {
  const agency = (host: string) => makeLoaderStore(createSystemDb(db.pool), host);
  const base = new Date("2026-11-10T09:00:00Z");

  it("слот одного сайта не задерживает другой: у каждого хоста своя очередь", async () => {
    await agency("www.nalog.gov.by").reserveSlot(base, 5000);
    const other = await agency("nbrb.by").reserveSlot(new Date(base.getTime() + 1000), 5000);
    expect(other.getTime()).toBe(base.getTime() + 1000);
    const same = await agency("www.nalog.gov.by").reserveSlot(
      new Date(base.getTime() + 1000),
      5000,
    );
    expect(same.getTime()).toBe(base.getTime() + 5000);
  });

  it("остановка цикла и robots.txt одного хоста не видны другому", async () => {
    await agency("www.nalog.gov.by").stop(day("2026-11-10"), "LOADER_BLOCKED");
    await agency("www.nalog.gov.by").saveRobots("Disallow: /", base);
    expect(await agency("nbrb.by").read()).toMatchObject({ stoppedOn: null, robotsTxt: null });
    expect(await store().read()).toMatchObject({ stoppedOn: null });
  });
});
