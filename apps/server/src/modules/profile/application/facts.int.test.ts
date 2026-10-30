// PROF-01…06, AUTH-07, P5 на Postgres: факт с источником, датой и статусом; подтвердить, исправить, удалить — с
// «Отменить» через настоящий журнал actions; удалённый факт фасад больше не возвращает; вывод системы —
// «предположение» и не перетирает подтверждённое; ответ в чате — источник «чат» со ссылкой на сообщение; анкета
// сохраняет отвеченное и больше не показывается; дети считаются на дату вопроса.
import type { FactValueInput } from "@kosht/contract";
import { FakeClock, testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb, type ScopedDb } from "../../../platform/db/scoped-db.ts";
import { factsWithJournal } from "./__fixtures__/facts-with-journal.ts";
import { makeKnownNames } from "./known-names.ts";

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

const queue = (status: "now" | "no", since: string | null = null): FactValueInput => ({
  key: "housingQueue",
  status,
  since,
});

describe("PROF-01, PROF-05: факт с источником, датой и статусом", () => {
  it("добавленный на странице факт — «указан вами», подтверждён, с датой; событие пачкой и сигнал сайту", async () => {
    const s = scoped();
    const { facts, published, signals } = factsWithJournal();
    const { fact } = await facts.set(s, { value: queue("now"), source: "user", channel: "web" });
    expect(fact).toMatchObject({
      topic: "housing",
      value: { key: "housingQueue", status: "now", since: null },
      source: "user",
      sourceRef: null,
      status: "confirmed",
      recordedOn: "2026-10-28",
      evaluation: null,
    });
    expect(published).toEqual([{ name: "profile.facts-changed", ids: [fact.id] }]);
    expect(signals).toEqual([{ entity: "profile-fact", ids: [fact.id] }]);
    expect((await facts.list(s)).facts.map((f) => f.id)).toEqual([fact.id]);
  });

  it("ключ PROF-01 один: повторная запись исправляет тот же факт, а не добавляет второй", async () => {
    const s = scoped();
    const { facts } = factsWithJournal();
    const first = await facts.set(s, { value: queue("no"), source: "user", channel: "web" });
    const second = await facts.set(s, { value: queue("now"), source: "user", channel: "web" });
    expect(second.fact.id).toBe(first.fact.id);
    expect((await facts.list(s)).facts).toHaveLength(1);
  });

  it("заметки — свои факты: две разные; правка по id; чужая тема у ключа PROF-01 — NOT_FOUND", async () => {
    const s = scoped();
    const { facts } = factsWithJournal();
    const note = (text: string): FactValueInput => ({
      key: "note",
      topic: "obligations",
      label: "Кружок робототехники",
      text,
    });
    const a = await facts.set(s, { value: note("60 BYN в месяц"), source: "user", channel: "web" });
    await facts.set(s, { value: note("по субботам"), source: "user", channel: "web" });
    const edited = await facts.set(s, {
      id: a.fact.id,
      value: note("70 BYN в месяц"),
      source: "user",
      channel: "web",
    });
    expect(edited.fact).toMatchObject({ id: a.fact.id, topic: "obligations" });
    expect((await facts.list(s)).facts).toHaveLength(2);
    await expect(
      facts.set(s, { id: a.fact.id, value: queue("now"), source: "user", channel: "web" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const queueFact = await facts.set(s, { value: queue("now"), source: "user", channel: "web" });
    await expect(
      facts.set(s, { id: queueFact.fact.id, value: note("x"), source: "user", channel: "web" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PROF-05, P5: подтвердить, исправить, удалить — с «Отменить»", () => {
  it("«Отменить» правки возвращает прежнее значение, отмена первой записи — факта снова нет", async () => {
    const s = scoped();
    const { facts, actions } = factsWithJournal();
    const first = await facts.set(s, { value: queue("no"), source: "user", channel: "web" });
    const second = await facts.set(s, {
      value: queue("now", "2019-01-01"),
      source: "user",
      channel: "web",
    });
    expect(await actions.undo(s, second.undoToken)).toBe("undone");
    expect((await facts.list(s)).facts).toMatchObject([{ value: { status: "no", since: null } }]);
    expect(await actions.undo(s, first.undoToken)).toBe("undone");
    expect((await facts.list(s)).facts).toEqual([]);
  });

  it("удалённый факт больше не возвращают ни список, ни фасад; «Отменить» — он снова есть", async () => {
    const s = scoped();
    const { facts, actions, clock } = factsWithJournal();
    const { fact } = await facts.set(s, {
      value: { key: "largeFamily", value: true },
      source: "user",
      channel: "web",
    });
    const token = await facts.remove(s, fact.id, "web");
    expect((await facts.list(s)).facts).toEqual([]);
    expect(await facts.getFacts(s, ["largeFamily"], clock.today())).toEqual([]);
    await expect(facts.remove(s, fact.id, "web")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await actions.undo(s, token);
    expect(await facts.getFacts(s, ["largeFamily"], clock.today())).toMatchObject([
      { id: fact.id, value: { value: true }, status: "confirmed" },
    ]);
  });

  it("удалённый ключ записывают снова — оживает та же строка с новым значением", async () => {
    const s = scoped();
    const { facts } = factsWithJournal();
    const { fact } = await facts.set(s, { value: queue("no"), source: "user", channel: "web" });
    await facts.remove(s, fact.id, "web");
    const again = await facts.set(s, { value: queue("now"), source: "user", channel: "web" });
    expect(again.fact).toMatchObject({ id: fact.id, value: { status: "now" } });
  });

  it("чужой факт — NOT_FOUND для подтверждения и удаления", async () => {
    const own = scoped();
    const other = scoped();
    const { facts } = factsWithJournal();
    const { fact } = await facts.set(other, {
      value: queue("now"),
      source: "user",
      channel: "web",
    });
    await expect(facts.confirm(own, fact.id, "web")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(facts.remove(own, fact.id, "web")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await facts.list(other)).facts).toHaveLength(1);
  });
});

describe("PROF-03: выводы системы — «предположение»", () => {
  it("вывод по выпискам — предположение; подтверждение — «подтверждён»; «Отменить» — снова предположение", async () => {
    const s = scoped();
    const { facts, actions } = factsWithJournal();
    const id = await facts.upsertDerivedFact(s, {
      value: { key: "income.salary", amount: { minor: 240_000, currency: "BYN" } },
      source: "statements",
      sourceRef: "statements.months",
    });
    expect((await facts.list(s)).facts).toMatchObject([
      { id, topic: "income", source: "statements", status: "assumed" },
    ]);
    const { fact, undoToken } = await facts.confirm(s, id ?? "", "web");
    expect(fact.status).toBe("confirmed");
    await actions.undo(s, undoToken);
    expect((await facts.list(s)).facts).toMatchObject([{ id, status: "assumed" }]);
  });

  it("подтверждённое человеком вывод системы не перетирает", async () => {
    const s = scoped();
    const { facts } = factsWithJournal();
    await facts.set(s, {
      value: { key: "property.car", value: false },
      source: "user",
      channel: "web",
    });
    const id = await facts.upsertDerivedFact(s, {
      value: { key: "property.car", value: true },
      source: "system",
    });
    expect(id).toBeUndefined();
    expect((await facts.list(s)).facts).toMatchObject([
      { value: { value: false }, source: "user", status: "confirmed" },
    ]);
  });
});

describe("PROF-05: удалённый человеком вывод системы не оживает", () => {
  it("человек удалил предположение «регулярный доход» — новый вывод его не возвращает; «Отменить» удаления возвращает", async () => {
    const s = scoped();
    const { facts, actions } = factsWithJournal();
    const value = (minor: number) => ({
      key: "income.regular" as const,
      amount: { minor, currency: "BYN" },
    });
    const id = await facts.upsertDerivedFact(s, { value: value(240_000), source: "system" });
    const undoToken = await facts.remove(s, id ?? "", "web");
    expect(
      await facts.upsertDerivedFact(s, { value: value(250_000), source: "system" }),
    ).toBeUndefined();
    expect((await facts.list(s)).facts).toEqual([]);
    await actions.undo(s, undoToken);
    expect((await facts.list(s)).facts).toMatchObject([
      { id, value: { amount: { minor: 240_000 } } },
    ]);
  });

  it("предположения, которого не было, вывод по-прежнему создаёт", async () => {
    const s = scoped();
    const { facts } = factsWithJournal();
    const id = await facts.upsertDerivedFact(s, {
      value: { key: "obligations.regular", amount: { minor: 100, currency: "BYN" } },
      source: "system",
    });
    expect(id).toBeDefined();
  });
});

describe("PROF-04, КП PROF: ответ на дозапрос запоминается фактом «чат»", () => {
  it("«да, мы с женой на учёте с 2019 года» → «учёт нуждающихся: да, с 2019», источник — чат и сообщение", async () => {
    const s = scoped();
    const { facts, clock } = factsWithJournal();
    await facts.recordAnswer(s, {
      value: queue("now", "2019-01-01"),
      messageId: "0199f0a0-0000-7000-8000-00000000a001",
      channel: "web",
    });
    expect(await facts.getFacts(s, ["housingQueue"], clock.today())).toMatchObject([
      {
        value: { status: "now", since: "2019-01-01" },
        source: "chat",
        sourceRef: "0199f0a0-0000-7000-8000-00000000a001",
        status: "confirmed",
      },
    ]);
  });
});

describe("PROF-06: факты с датой — на дату вопроса", () => {
  it("ребёнок, названный 17-летним, через год в детях для вычета не учитывается (часы — Clock)", async () => {
    const s = scoped();
    const clock = new FakeClock("2026-10-28T09:00:00Z");
    const { facts } = factsWithJournal(clock);
    await facts.set(s, {
      value: { key: "children", children: [{ age: 17 }, { birthDate: "2017-05-01" }] },
      source: "user",
      channel: "web",
    });
    expect((await facts.list(s)).facts[0]?.evaluation).toEqual({
      onDate: "2026-10-28",
      childAges: [17, 9],
      childrenUnder18: 2,
    });
    clock.set("2027-10-28T09:00:00Z");
    expect((await facts.list(s)).facts[0]?.evaluation).toMatchObject({
      childAges: [18, 10],
      childrenUnder18: 1,
    });
  });
});

describe("AUTH-07, PROF-02: анкета на 1 минуту", () => {
  it("до анкеты — pending; ответы — факты «анкета», пропущенное не сохраняется; после — done навсегда", async () => {
    const s = scoped();
    const { facts, published } = factsWithJournal();
    expect(await facts.onboarding(s)).toEqual({ status: "pending" });
    const { facts: saved } = await facts.completeOnboarding(s, {
      employment: ["employee", "npd"],
      children: [{ age: 9 }],
      benefitCategory: false,
      familyStatus: [],
    });
    expect(saved.map((f) => [f.value.key, f.source, f.status])).toEqual([
      ["employment", "questionnaire", "confirmed"],
      ["children", "questionnaire", "confirmed"],
      ["benefitCategory", "questionnaire", "confirmed"],
      ["familyStatus", "questionnaire", "confirmed"],
    ]);
    expect(published).toEqual([{ name: "profile.facts-changed", ids: saved.map((f) => f.id) }]);
    expect(await facts.onboarding(s)).toEqual({ status: "done" });
    await facts.completeOnboarding(s, {});
    expect(await facts.onboarding(s)).toEqual({ status: "done" });
  });

  it("пропущенная анкета целиком — фактов нет, но больше не показывается", async () => {
    const s = scoped();
    const { facts, published } = factsWithJournal();
    expect(await facts.completeOnboarding(s, {})).toEqual({ facts: [] });
    expect(published).toEqual([]);
    expect(await facts.onboarding(s)).toEqual({ status: "done" });
  });

  it("все шесть вопросов: учёт нуждающихся и молодой специалист тоже сохраняются", async () => {
    const s = scoped();
    const { facts } = factsWithJournal();
    const { facts: saved } = await facts.completeOnboarding(s, {
      housingQueue: "before",
      youngSpecialist: true,
    });
    expect(saved.map((f) => f.value)).toEqual([
      { key: "housingQueue", status: "before", since: null },
      { key: "youngSpecialist", value: true, until: null },
    ]);
  });
});

describe("PRIV-03: имена детей — словарь маскирования", () => {
  const children = (...names: (string | null)[]): FactValueInput => ({
    key: "children",
    children: names.map((name) => ({ name, birthDate: null, age: 7, disability: false })),
  });

  it("имена из действующего факта «дети»; пустые и повторы не попадают; удалённый факт — ничего", async () => {
    const s = scoped();
    const { facts } = factsWithJournal();
    const names = makeKnownNames({ scoped: (scope) => createScopedDb(db.pool, scope) });
    expect(await names(s.scope)).toEqual([]);
    const { fact } = await facts.set(s, {
      value: children("Анна", null, "Анна", "Игорь"),
      source: "user",
      channel: "web",
    });
    expect(await names(s.scope)).toEqual(["Анна", "Игорь"]);
    await facts.remove(s, fact.id, "web");
    expect(await names(s.scope)).toEqual([]);
  });

  it("ROLE-01: имена другого домохозяйства не видны", async () => {
    const a = scoped();
    const b = scoped();
    const { facts } = factsWithJournal();
    const names = makeKnownNames({ scoped: (scope) => createScopedDb(db.pool, scope) });
    await facts.set(a, { value: children("Секретное"), source: "user", channel: "web" });
    expect(await names(b.scope)).toEqual([]);
  });
});
