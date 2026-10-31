// LEGAL-03, CHAT-10: разбор черновика ответа модели — метки `[[F<id версии>]]` и `[[A<id акта>]]`, вольные цитаты в кавычках и
// их привязка к меткам. Чистая функция, без БД и моделей (NFR-11).
import { describe, expect, it } from "vitest";
import { scanDraft, type ScanItem } from "./draft.ts";

const F1 = "019e0000-0000-7000-8000-00000000a001";
const F2 = "019e0000-0000-7000-8000-00000000a002";

const marks = (items: readonly ScanItem[]) => items.flatMap((i) => (i.type === "mark" ? [i] : []));
const quotes = (items: readonly ScanItem[]) =>
  items.flatMap((i) => (i.type === "quote" ? [i] : []));

describe("LEGAL-03: метки в черновике", () => {
  it("находит метку версии фрагмента и метку акта; остальной текст остаётся текстом", () => {
    const items = scanDraft(`Вычет — 216 рублей [[F${F1}]]. Перечень — [[AC20200778]].`);
    expect(marks(items).map((m) => [m.kind, m.id])).toEqual([
      ["fragment", F1],
      ["act", "C20200778"],
    ]);
    expect(items.filter((i) => i.type === "text").map((i) => i.text)).toEqual([
      "Вычет — 216 рублей ",
      ". Перечень — ",
      ".",
    ]);
  });

  it("регистр id версии не важен — id приводится к нижнему", () => {
    const items = scanDraft(`[[F${F1.toUpperCase()}]]`);
    expect(marks(items)[0]).toMatchObject({ kind: "fragment", id: F1 });
  });

  it("метка не того вида (`[[F12.2]]`, пустая, с мусором, id не uuid) — невалидная, а не текст ответа", () => {
    const items = scanDraft("раз [[F12.2]] два [[F]] три [[Fне-uuid]] четыре [[X1]] пять [[ A1 ]]");
    expect(marks(items).map((m) => m.kind)).toEqual([
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
    ]);
    expect(items.some((i) => i.type === "text" && i.text.includes("[["))).toBe(false);
  });

  it("порядковые номера меток идут подряд", () => {
    const items = scanDraft(`[[F${F1}]] и [[F${F2}]]`);
    expect(marks(items).map((m) => m.index)).toEqual([0, 1]);
  });
});

describe("LEGAL-03: вольные цитаты и привязка к меткам", () => {
  it("цитата в «ёлочках» прямо перед меткой привязана к ней", () => {
    const items = scanDraft(`Вычет предоставляется «в размере 216 рублей» [[F${F1}]].`);
    const [q] = quotes(items);
    expect(q).toMatchObject({ text: "в размере 216 рублей", markIndexes: [0] });
  });

  it("привязана и при знаках между цитатой и меткой: «…», [[F]] / «…»: [[F]] / «…»)[[F]]", () => {
    for (const glue of [", ", ": ", ") ", ";", " . "]) {
      const items = scanDraft(`«не менее трёх лет»${glue}[[F${F1}]]`);
      expect(quotes(items)[0]?.markIndexes).toEqual([0]);
    }
  });

  it("одна цитата — две метки подряд: привязана к обеим", () => {
    const items = scanDraft(`«семь дней» [[F${F1}]], [[F${F2}]]`);
    expect(quotes(items)[0]?.markIndexes).toEqual([0, 1]);
  });

  it('цитата с другими видами кавычек: „…“, “…”, "…" — тоже цитата', () => {
    for (const [open, close] of [
      ["„", "“"],
      ["“", "”"],
      ['"', '"'],
    ] as const) {
      const items = scanDraft(`${open}четырнадцать дней${close} [[F${F1}]]`);
      expect(quotes(items)[0]).toMatchObject({
        text: "четырнадцать дней",
        markIndexes: [0],
      });
    }
  });

  it("вложенные «ёлочки» внутри цитаты остаются в её тексте", () => {
    const items = scanDraft(`«закон «О защите» гласит» [[F${F1}]]`);
    expect(quotes(items)[0]?.text).toBe("закон «О защите» гласит");
  });

  it("цитата без метки рядом не привязана: слова дальше трёх знаков от метки — уже другое предложение", () => {
    const items = scanDraft(`«семь дней» — это срок, и ещё [[F${F1}]]`);
    expect(quotes(items)[0]?.markIndexes).toEqual([]);
  });

  it("метка перед цитатой её не привязывает (формат — «цитата» [[F]])", () => {
    const items = scanDraft(`[[F${F1}]] «семь дней»`);
    expect(quotes(items)[0]?.markIndexes).toEqual([]);
  });

  it("из двух цитат подряд привязана только последняя", () => {
    const items = scanDraft(`«раз два три» и «четыре пять» [[F${F1}]]`);
    expect(quotes(items).map((q) => q.markIndexes)).toEqual([[], [0]]);
  });

  it("исходный текст собирается обратно без потерь, кроме меток", () => {
    const draft = `Начало «цитата раз два» [[F${F1}]], и «ещё одна» конец.`;
    const rebuilt = scanDraft(draft)
      .map((i) => (i.type === "text" ? i.text : i.type === "quote" ? i.raw : ""))
      .join("");
    expect(rebuilt).toBe(draft.replace(`[[F${F1}]]`, ""));
  });

  it("метка внутри кавычек выносится за них: цитата привязана к ней и проверяется, а не остаётся непроверенной", () => {
    const items = scanDraft(`Вычет «в размере 217 рублей [[F${F1}]]» в месяц.`);
    expect(quotes(items)[0]).toMatchObject({ text: "в размере 217 рублей", markIndexes: [0] });
    expect(marks(items)).toHaveLength(1);
  });

  it("незакрытая кавычка не ломает разбор и цитатой не считается", () => {
    const items = scanDraft(`«незакрытая цитата [[F${F1}]]`);
    expect(quotes(items)).toEqual([]);
    expect(marks(items)).toHaveLength(1);
  });
});
