// LEGAL-12, CHAT-04, ROLE-01 на настоящем Postgres: состояние галочек хранится у домохозяйства для каждого «к чему относится» отдельно;
// отметить и снять — повторяемо и не теряет параллельные нажатия; заметку отметить нельзя; чужие галочки не видны.
import { createLegalT } from "@kosht/i18n";
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb, type ScopedDb } from "../../../platform/db/scoped-db.ts";
import { makeChecklists } from "./checklists.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

const checklists = makeChecklists({ t: createLegalT() });
let household = 100;
const household1 = (): ScopedDb => {
  household += 1;
  return createScopedDb(db.pool, testScope({ user: household, household }));
};

const MESSAGE = "019e1111-0000-7000-8000-000000000001";
const OTHER = "019e1111-0000-7000-8000-000000000002";
const general = { kind: "general" } as const;
const message = (id: string) => ({ kind: "message", id }) as const;
const checkedIds = (view: { items: { id: string; checked: boolean | null }[] }) =>
  view.items.filter((i) => i.checked === true).map((i) => i.id);

describe("LEGAL-12: чек-лист с состоянием галочек", () => {
  it("свежий чек-лист: ничего не отмечено, заметки без галочки, срок, инстанция и ссылка на норму приходят текстом", async () => {
    const s = household1();
    const view = await checklists.get(s, { id: "return-good-quality", subject: general });
    expect(view).toMatchObject({
      id: "return-good-quality",
      title: "Возврат или обмен товара надлежащего качества",
    });
    expect(view.done).toBe(0);
    const notes = view.items.filter((i) => i.kind === "note");
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.every((i) => i.checked === null)).toBe(true);
    expect(view.total).toBe(view.items.length - notes.length);
    const term = view.items.find((i) => i.id === "term");
    expect(term).toMatchObject({
      kind: "step",
      instance: { id: "seller", label: "Продавец" },
      deadline: expect.stringContaining("четырнадцать дней"),
      norm: {
        ref: "п. 1 ст. 28 ЗоЗПП",
        url: "https://pravo.by/document/?guid=3871&p0=H10200090",
        unsaved: false,
      },
    });
    // LEGAL-06: перечень невозвратных товаров — акт без текста: ссылка на карточку.
    expect(view.items.find((i) => i.id === "list")?.act).toEqual({
      url: "https://pravo.by/document/?guid=3961&p0=C20200778",
    });
  });

  it("отметить пункт — он остаётся отмеченным при следующем чтении; повтор не плодит строк; снять — уходит", async () => {
    const s = household1();
    const first = await checklists.setChecked(s, {
      id: "return-good-quality",
      subject: general,
      item: "proof",
      done: true,
    });
    expect(checkedIds(first)).toEqual(["proof"]);
    expect(first.done).toBe(1);
    await checklists.setChecked(s, {
      id: "return-good-quality",
      subject: general,
      item: "proof",
      done: true,
    });
    const again = await checklists.get(s, { id: "return-good-quality", subject: general });
    expect(checkedIds(again)).toEqual(["proof"]);
    const rows = await db.owner.query(
      "select 1 from checklist_progress where item_id = 'proof' and subject = 'general' and household_id = $1",
      [s.scope.householdId],
    );
    expect(rows.rowCount).toBe(1);
    const cleared = await checklists.setChecked(s, {
      id: "return-good-quality",
      subject: general,
      item: "proof",
      done: false,
    });
    expect(checkedIds(cleared)).toEqual([]);
    // Снять неотмеченное — не ошибка.
    await checklists.setChecked(s, {
      id: "return-good-quality",
      subject: general,
      item: "proof",
      done: false,
    });
  });

  it("у каждого сообщения и у «просто так» своё состояние; у другого чек-листа — тоже", async () => {
    const s = household1();
    const done = { id: "warranty", item: "proof", done: true } as const;
    await checklists.setChecked(s, { ...done, subject: message(MESSAGE) });
    expect(
      checkedIds(await checklists.get(s, { id: "warranty", subject: message(MESSAGE) })),
    ).toEqual(["proof"]);
    expect(
      checkedIds(await checklists.get(s, { id: "warranty", subject: message(OTHER) })),
    ).toEqual([]);
    expect(checkedIds(await checklists.get(s, { id: "warranty", subject: general }))).toEqual([]);
    expect(
      checkedIds(await checklists.get(s, { id: "return-good-quality", subject: message(MESSAGE) })),
    ).toEqual([]);
  });

  it("параллельные нажатия на разные пункты не теряются", async () => {
    const s = household1();
    await Promise.all(
      ["term", "list", "condition", "proof", "go-seller"].map((item) =>
        checklists.setChecked(s, { id: "return-good-quality", subject: general, item, done: true }),
      ),
    );
    expect(
      checkedIds(
        await checklists.get(s, { id: "return-good-quality", subject: general }),
      ).toSorted(),
    ).toEqual(["condition", "go-seller", "list", "proof", "term"]);
  });

  it("заметка и неизвестный пункт отметить нельзя — VALIDATION", async () => {
    const s = household1();
    for (const item of ["food", "нет-такого"]) {
      await expect(
        checklists.setChecked(s, { id: "return-good-quality", subject: general, item, done: true }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });

  it("ROLE-01: чужие галочки не видны — другое домохозяйство с тем же сообщением видит пустой чек-лист", async () => {
    const a = household1();
    const b = household1();
    await checklists.setChecked(a, {
      id: "claim-defective",
      subject: message(MESSAGE),
      item: "to-whom",
      done: true,
    });
    expect(
      checkedIds(await checklists.get(b, { id: "claim-defective", subject: message(MESSAGE) })),
    ).toEqual([]);
    // Снять у себя то, что отмечено у соседа, — нельзя: строка соседа остаётся.
    await checklists.setChecked(b, {
      id: "claim-defective",
      subject: message(MESSAGE),
      item: "to-whom",
      done: false,
    });
    expect(
      checkedIds(await checklists.get(a, { id: "claim-defective", subject: message(MESSAGE) })),
    ).toEqual(["to-whom"]);
  });

  it("набор: шесть чек-листов с названием и описанием; шаблон без состояния — без галочек", () => {
    const list = checklists.list();
    expect(list.map((c) => c.id)).toEqual([
      "deduction-education",
      "deduction-housing",
      "deduction-standard",
      "return-good-quality",
      "claim-defective",
      "warranty",
    ]);
    expect(list.every((c) => c.title.length > 5 && c.summary.length > 20)).toBe(true);
    expect(checklists.template("warranty").done).toBe(0);
  });

  it("чек-лист на жильё: нормы ст. 211, 222 найдены в базе — ни один пункт не помечен «текста нет»", async () => {
    const view = await checklists.get(household1(), { id: "deduction-housing", subject: general });
    expect(view.items.every((i) => i.norm !== null && i.norm.unsaved === false)).toBe(true);
    expect(view.items.some((i) => i.instance?.id === "executive-committee")).toBe(true);
  });
});
