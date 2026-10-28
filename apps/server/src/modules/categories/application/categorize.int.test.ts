// CAT-01…07, RCPT-15, LLM-05 на Postgres с сидом миграций: гибридный порядок — правила пользователя → справочник
// контрагентов → ключевые слова → MCC → модель; позиции чека — тем же порядком; модель — один запрос на пачку
// непокрытых (шпион шлюза), строго из существующих категорий; кэш одинаковых классификаций — только своего
// домохозяйства; сбой модели и метка вне списка — «Прочее» (fallback); справочник категорий — встроенные и свои.
import { SYSTEM_CATEGORIES } from "@kosht/contract";
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedCache } from "../../../platform/cache/scoped-cache.ts";
import { createScopedDb, type ScopedDb } from "../../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { SystemPlatform } from "../../../platform/module/define-module.ts";
import { createMerchantsModule } from "../../merchants/index.ts";
import { makeCatalog } from "./catalog.ts";
import { makeCategorize } from "./categorize.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

let household = 0;
function scoped(): ScopedDb {
  household += 1;
  return createScopedDb(db.pool, testScope({ user: household, household }));
}

interface ExtractCall {
  readonly task: string;
  readonly document: string;
  readonly instructions: string;
}

/** Шпион шлюза: отвечает функцией answer по строкам документа, записывает вызовы. */
function spyLlm(answer: (lines: string[]) => { line: number; label: string }[] | Error) {
  const calls: ExtractCall[] = [];
  return {
    calls,
    llm: {
      extract: async (_caller: unknown, request: ExtractCall) => {
        calls.push({
          task: request.task,
          document: request.document,
          instructions: request.instructions,
        });
        const lines = request.document.split("\n").map((line) => line.replace(/^\d+\. /, ""));
        const result = answer(lines);
        if (result instanceof Error) throw result;
        return { results: result } as never;
      },
    },
  };
}

const clock = new FakeClock("2026-10-28T09:00:00Z");

function setup(answer: (lines: string[]) => { line: number; label: string }[] | Error = () => []) {
  const system = createSystemDb(db.pool);
  const settings = {
    get: async (def: { key: string; default: unknown }) => def.default as never,
  };
  const merchants = createMerchantsModule({
    platform: { system, settings } as unknown as SystemPlatform,
    facades: {} as never,
  }).facade;
  const spy = spyLlm(answer);
  const log = memoryLogger();
  const categorize = makeCategorize({
    system,
    merchants,
    llm: spy.llm as never,
    settings,
    cache: createScopedCache<string>({ max: 100, ttlMs: 60_000, clock }),
    log: log.log,
  });
  const catalog = makeCatalog({
    system,
    platform: { clock, realtime: { changed: async () => {}, progress: async () => {} } },
  });
  return { categorize, catalog, calls: spy.calls, log };
}

const op = (key: string, description: string, extra: { mcc?: string; kind?: "income" } = {}) => ({
  key,
  kind: extra.kind ?? ("expense" as const),
  description,
  ...(extra.mcc === undefined ? {} : { mcc: extra.mcc }),
});

describe("CAT-01: встроенные категории — сид миграции совпадает с контрактом", () => {
  it("33 встроенные в порядке CAT-01 с иконками и цветами; свои — отдельно", async () => {
    const s = scoped();
    const { catalog } = setup();
    const { items } = await catalog.list(s);
    expect(
      items.map((item) => ({
        code: item.ref.type === "system" ? item.ref.code : "",
        kind: item.kind,
        icon: item.icon,
        color: item.color,
      })),
    ).toEqual(
      SYSTEM_CATEGORIES.map(({ code, kind, icon, color }) => ({ code, kind, icon, color })),
    );
  });
});

describe("CAT-03: гибридный порядок — правила без модели", () => {
  it("справочник, ключевое слово, MCC, CAT-07 кредит; незнакомое — модели; источник у каждого", async () => {
    const s = scoped();
    const { categorize, calls } = setup(() => []);
    const { resolved, pending } = await categorize.byRules(s, [
      op("evroopt", "OOO EVROTORG T-0042 MINSK UL. LENINA 12"),
      op("taxi", "Оплата ТАКСИ 7788"),
      op("mcc", "SHOP NO NAME MCC 5912"),
      op("loan", "ПОГАШЕНИЕ КРЕДИТА ПО ДОГОВОРУ 123"),
      op("salary", "ЗАРПЛАТА ЗА ОКТЯБРЬ", { kind: "income" }),
      op("unknown", "ZZZ STUDIO 15"),
    ]);
    expect(resolved).toEqual([
      { key: "evroopt", category: { type: "system", code: "groceries" }, source: "merchant" },
      { key: "taxi", category: { type: "system", code: "taxi" }, source: "keyword" },
      { key: "mcc", category: { type: "system", code: "health" }, source: "mcc" },
      { key: "loan", category: { type: "system", code: "loans" }, source: "keyword" },
      { key: "salary", category: { type: "system", code: "salary" }, source: "keyword" },
    ]);
    expect(pending).toMatchObject([{ key: "unknown", text: "Zzz Studio" }]);
    expect(calls).toEqual([]);
  });

  it("КП CAT, CAT-05: правило пользователя «ТАКСИ» → «Общественный транспорт» важнее ключевого слова, без модели", async () => {
    const s = scoped();
    const { categorize, catalog, calls } = setup();
    await catalog.setUserRule(s, {
      matcher: "merchant",
      pattern: "такси",
      category: { type: "system", code: "transport" },
    });
    expect(await categorize.categorize(s, [op("next", "ТАКСИ 7788")])).toEqual([
      { key: "next", category: { type: "system", code: "transport" }, source: "user-rule" },
    ]);
    expect(calls).toEqual([]);
  });
});

describe("CAT-04, RCPT-15: позиции чека — тем же порядком по наименованию", () => {
  it("«Молоко 3,2%» → Продукты, «Бальзам для волос» → Красота и гигиена; правило пользователя для позиции", async () => {
    const s = scoped();
    const { categorize, catalog } = setup();
    await catalog.setUserRule(s, {
      matcher: "item",
      pattern: "Корм для кота",
      category: { type: "system", code: "pets" },
    });
    const { resolved, pending } = await categorize.byRules(s, [
      { key: "milk", kind: "expense", item: "Молоко 3,2% 1л" },
      { key: "balm", kind: "expense", item: "Бальзам для волос 200 мл" },
      { key: "cat", kind: "expense", item: "Корм для кота 400г" },
      { key: "toy", kind: "expense", item: "Игрушка-пищалка" },
    ]);
    expect(resolved).toEqual([
      { key: "milk", category: { type: "system", code: "groceries" }, source: "keyword" },
      { key: "balm", category: { type: "system", code: "beauty" }, source: "keyword" },
      { key: "cat", category: { type: "system", code: "pets" }, source: "user-rule" },
    ]);
    expect(pending).toMatchObject([{ key: "toy", text: "Игрушка-пищалка" }]);
  });
});

describe("CAT-06, LLM-05: модель — пакетом и только для непокрытых", () => {
  it("из 100 операций 90 покрыты правилами — модель вызвана один раз на 10 строк, строго из списка", async () => {
    const s = scoped();
    const { categorize, calls } = setup((lines) =>
      lines.map((_, i) => ({ line: i + 1, label: "leisure" })),
    );
    const inputs = [
      ...Array.from({ length: 90 }, (_, i) => op(`taxi-${String(i)}`, `ТАКСИ ${String(1000 + i)}`)),
      ...Array.from({ length: 10 }, (_, i) =>
        op(
          `new-${String(i)}`,
          `STUDIA ${["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"][i] ?? ""}`,
        ),
      ),
    ];
    const result = await categorize.categorize(s, inputs);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.task).toBe("classify.category");
    expect(calls[0]?.document.split("\n")).toHaveLength(10);
    expect(calls[0]?.instructions).toContain("- leisure: Развлечения, спорт и хобби");
    expect(calls[0]?.instructions).not.toContain("- salary:");
    expect(result.map((r) => r.key)).toEqual(inputs.map((i) => i.key));
    expect(result.filter((r) => r.source === "keyword")).toHaveLength(90);
    expect(
      result
        .slice(90)
        .every(
          (r) =>
            r.source === "model" && r.category.type === "system" && r.category.code === "leisure",
        ),
    ).toBe(true);
  });

  it("одинаковое — из кэша своего домохозяйства; у другого домохозяйства кэш свой", async () => {
    const { categorize, calls } = setup((lines) =>
      lines.map((_, i) => ({ line: i + 1, label: "gifts" })),
    );
    const a = scoped();
    const b = scoped();
    await categorize.categorize(a, [op("1", "LAVKA PODARKOV")]);
    expect(await categorize.categorize(a, [op("2", "LAVKA PODARKOV")])).toEqual([
      { key: "2", category: { type: "system", code: "gifts" }, source: "cache" },
    ]);
    await categorize.categorize(b, [op("3", "LAVKA PODARKOV")]);
    expect(calls).toHaveLength(2);
  });

  it("модель недоступна — «Прочее» с источником fallback, без ошибки; в логе — без текста", async () => {
    const s = scoped();
    const { categorize, log } = setup(() => new Error("сеть"));
    expect(
      await categorize.categorize(s, [
        op("x", "NEPONYATNO 1"),
        op("y", "VOZVRAT DOLGA", { kind: "income" }),
      ]),
    ).toEqual([
      { key: "x", category: { type: "system", code: "other" }, source: "fallback" },
      { key: "y", category: { type: "system", code: "other-income" }, source: "fallback" },
    ]);
    expect(log.text()).toContain("categories.model-failed");
    expect(log.text()).not.toContain("NEPONYATNO");
  });

  it("метка вне списка (скрытая или выдуманная) — «Прочее» fallback; своя категория — по метке custom", async () => {
    const s = scoped();
    let customLabel = "";
    const { categorize, catalog } = setup((lines) =>
      lines.map((line, i) => ({
        line: i + 1,
        label: line.startsWith("Krug") ? customLabel : line.startsWith("Nezn") ? "no-such" : "taxi",
      })),
    );
    await catalog.setHidden(s, { ref: { type: "system", code: "taxi" }, hidden: true });
    const { item } = await catalog.create(s, {
      name: "Кружки",
      kind: "expense",
      icon: "ticket",
      color: "kids",
    });
    customLabel = item.ref.type === "custom" ? `custom-${item.ref.id}` : "";
    expect(
      await categorize.categorize(s, [
        op("a", "KRUGOZOR"),
        op("b", "NEZNAKOMEC"),
        op("c", "PROKAT VELO"),
      ]),
    ).toEqual([
      { key: "a", category: item.ref, source: "model" },
      { key: "b", category: { type: "system", code: "other" }, source: "fallback" },
      { key: "c", category: { type: "system", code: "other" }, source: "fallback" },
    ]);
  });
});

describe("CAT-02: свои категории и скрытие встроенных", () => {
  it("добавить, переименовать, скрыть; такое же название — CONFLICT; встроенная только скрывается и показывается", async () => {
    const s = scoped();
    const { catalog } = setup();
    const { item } = await catalog.create(s, {
      name: "Секции",
      kind: "expense",
      icon: "ticket",
      color: "kids",
    });
    await expect(
      catalog.create(s, { name: "секции", kind: "expense", icon: "ticket", color: "kids" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    if (item.ref.type !== "custom") throw new Error("своя категория");
    const id = item.ref.id;
    expect((await catalog.rename(s, { id, name: "Кружки и секции" })).item.name).toBe(
      "Кружки и секции",
    );
    const other = await catalog.create(s, {
      name: "Хобби",
      kind: "expense",
      icon: "ticket",
      color: "kids",
    });
    await expect(catalog.rename(s, { id, name: "хобби" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(other.item.name).toBe("Хобби");
    expect((await catalog.setHidden(s, { ref: item.ref, hidden: true })).item.hidden).toBe(true);
    const taxi = { type: "system" as const, code: "taxi" as const };
    expect((await catalog.setHidden(s, { ref: taxi, hidden: true })).item.hidden).toBe(true);
    expect((await catalog.setHidden(s, { ref: taxi, hidden: true })).item.hidden).toBe(true);
    expect((await catalog.setHidden(s, { ref: taxi, hidden: false })).item.hidden).toBe(false);
  });

  it("чужая своя категория — NOT_FOUND для переименования, скрытия и правила", async () => {
    const own = scoped();
    const other = scoped();
    const { catalog } = setup();
    const { item } = await catalog.create(other, {
      name: "Чужая",
      kind: "expense",
      icon: "ticket",
      color: "kids",
    });
    if (item.ref.type !== "custom") throw new Error("своя категория");
    await expect(catalog.rename(own, { id: item.ref.id, name: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(catalog.setHidden(own, { ref: item.ref, hidden: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      catalog.setUserRule(own, { matcher: "merchant", pattern: "X", category: item.ref }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
