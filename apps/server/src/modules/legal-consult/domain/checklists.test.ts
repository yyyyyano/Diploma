// LEGAL-12, LEGAL-10, P1: шаблоны чек-листов — полнота и честность содержания без БД: у каждого пункта есть текст в словаре, у срока — подпись, у
// инстанции — название; сумм вычетов и ставок в тексте нет (их даёт таблица ставок).
import { CHECKLIST_IDS, CHECKLIST_INSTANCES } from "@kosht/contract";
import { createLegalT, legalTexts } from "@kosht/i18n";
import { describe, expect, it } from "vitest";
import { CHECKLISTS, checklistById } from "./checklists.ts";

const t = createLegalT();
interface Entry {
  readonly title: string;
  readonly summary: string;
  readonly items: Readonly<Record<string, string>>;
  readonly deadlines?: Readonly<Record<string, string>>;
}
const texts: Readonly<Record<string, Entry>> = legalTexts.checklists;

describe("LEGAL-12: набор и состав чек-листов", () => {
  it("шесть чек-листов MVP — вычет на обучение, на жильё, стандартные по ст. 209, возврат надлежащего качества, ненадлежащего, гарантия", () => {
    expect(CHECKLISTS.map((c) => c.id)).toEqual([...CHECKLIST_IDS]);
    expect(checklistById("warranty")?.id).toBe("warranty");
    expect(checklistById("нет такого")).toBeUndefined();
  });

  it("у каждого чек-листа есть название и описание, у каждого пункта — текст, у пункта со сроком — подпись срока, лишних текстов нет", () => {
    const problems: string[] = [];
    for (const list of CHECKLISTS) {
      const entry = texts[list.id];
      if (entry === undefined) {
        problems.push(`${list.id}: нет текстов`);
        continue;
      }
      for (const item of list.items) {
        const text = entry.items[item.id];
        if (typeof text !== "string" || text.length <= 20)
          problems.push(`${list.id}/${item.id}: нет текста`);
        if ((entry.deadlines?.[item.id] !== undefined) !== (item.deadline === true)) {
          problems.push(`${list.id}/${item.id}: подпись срока не сходится с шаблоном`);
        }
      }
      const items = Object.keys(entry.items).toSorted();
      if (
        items.join() !==
        list.items
          .map((i) => i.id)
          .toSorted()
          .join()
      )
        problems.push(`${list.id}: лишние тексты пунктов`);
      const deadlines = Object.keys(entry.deadlines ?? {}).toSorted();
      const flagged = list.items
        .filter((i) => i.deadline === true)
        .map((i) => i.id)
        .toSorted();
      if (deadlines.join() !== flagged.join()) problems.push(`${list.id}: лишние подписи сроков`);
      if (entry.title.length <= 5 || entry.summary.length <= 20)
        problems.push(`${list.id}: нет названия`);
    }
    expect(problems).toEqual([]);
  });

  it("пункты внутри чек-листа не повторяются; у каждой инстанции есть название", () => {
    const repeated = CHECKLISTS.flatMap((list) => {
      const ids = list.items.map((i) => i.id);
      return ids.filter((id, at) => ids.indexOf(id) !== at).map((id) => `${list.id}/${id}`);
    });
    expect(repeated).toEqual([]);
    for (const instance of CHECKLIST_INSTANCES) {
      expect(t(`instance.${instance}`).length).toBeGreaterThan(2);
    }
    const used = new Set(CHECKLISTS.flatMap((c) => c.items.flatMap((i) => i.instance ?? [])));
    expect(used.size).toBeGreaterThan(5);
  });

  it("LEGAL-12: названы инстанции из требования — наниматель, ИМНС, продавец; исполком — в чек-листе на жильё", () => {
    const instances = (id: string) =>
      new Set(checklistById(id)?.items.flatMap((i) => i.instance ?? []));
    expect(instances("deduction-education")).toContain("employer");
    expect(instances("deduction-education")).toContain("tax-office");
    expect(instances("deduction-housing")).toContain("executive-committee");
    expect(instances("return-good-quality")).toContain("seller");
  });
});

describe("P3: у каждого пункта есть норма; у пункта с нормой в базе — слова нормы", () => {
  const norms = CHECKLISTS.flatMap((c) =>
    c.items.flatMap((i) =>
      i.norm === undefined ? [] : [{ list: c.id, item: i.id, norm: i.norm }],
    ),
  );

  it("заметки и шаги без нормы и без акта-ссылки не допускаются", () => {
    const bare = CHECKLISTS.flatMap((list) =>
      list.items
        .filter((item) => item.norm === undefined && item.act === undefined)
        .map((item) => `${list.id}/${item.id}`),
    );
    expect(bare).toEqual([]);
  });

  it("слова нормы (`evidence`) обязательны у каждого пункта с нормой; пометки «текста нет в базе» нет ни у одного (T-045: ст. 211, 222, 223 сохранены)", () => {
    const problems = norms.flatMap(({ list, item, norm }) =>
      norm.unsaved !== true && norm.evidence !== undefined && norm.evidence !== ""
        ? []
        : [`${list}/${item}: ${norm.ref}`],
    );
    expect(problems).toEqual([]);
  });

  it("обращения в формате поиска: «п. N ст. M НК» или «ЗоЗПП»", () => {
    for (const { norm } of norms) {
      expect(norm.ref).toMatch(/^(?:п\. \d+(?:\.\d+)? )?ст\. \d+ (?:НК|ЗоЗПП)$/u);
    }
  });
});

describe("P1: суммы и ставки в текстах чек-листов не пишутся", () => {
  it("нет ни одной денежной суммы и ни одной ставки в процентах: вычеты и ставки берутся из таблицы ставок", () => {
    const all = JSON.stringify(legalTexts.checklists);
    expect(all).not.toMatch(/\d[\d\s]*\s*(?:бел\p{L}*\s+)?(?:руб|BYN|коп)/iu);
    expect(all).not.toMatch(/\d\s*%/u);
  });
});
