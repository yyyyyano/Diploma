// LEGAL-03, P3: дословность цитаты проверяет программа, а не модель. Нормализация (пробелы, кавычки, ё/е, дефисы) — свойствами
// fast-check (NFR-11: без сети и моделей); адверсариальные случаи — подмена числа, обрезанное число, склейка кусков не по порядку.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isVerbatim, normalizeForQuote, wordCount } from "./verbatim.ts";

const NORM =
  "1.1. в размере 216 белорусских рублей в месяц при получении дохода, подлежащего налогообложению, в сумме, не превышающей 1308 белорусских рублей в месяц;";

describe("LEGAL-03: нормализация текста для сверки цитат", () => {
  it("идемпотентна на любой строке Unicode", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (text) => {
        const once = normalizeForQuote(text);
        expect(normalizeForQuote(once)).toBe(once);
      }),
      { numRuns: 500 },
    );
  });

  it("разные пробелы (обычные, неразрывные, узкие, переводы строк) не меняют результат", () => {
    const space = fc.constantFrom(" ", "  ", " ", " ", " ", "\n", "\t", "   ");
    const word = fc.stringMatching(/^[а-яё0-9]{1,9}$/u);
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 1, maxLength: 12 }),
        fc.array(space, { minLength: 12, maxLength: 12 }),
        fc.array(space, { minLength: 12, maxLength: 12 }),
        (words, a, b) => {
          const join = (gaps: readonly string[]) =>
            words.map((w, i) => (i === 0 ? w : `${gaps[i] ?? " "}${w}`)).join("");
          expect(normalizeForQuote(join(a))).toBe(normalizeForQuote(join(b)));
        },
      ),
    );
  });

  it("все виды кавычек и апострофов, ё/е, регистр и виды дефиса считаются одним и тем же", () => {
    expect(normalizeForQuote('«Ёлка» — „иное“ “так” "так"')).toBe(
      normalizeForQuote('"елка" - "иное" "так" "так"'),
    );
    expect(normalizeForQuote("по‑новому, по–новому, по—новому, по−новому")).toBe(
      "по-новому, по-новому, по-новому, по-новому",
    );
    expect(normalizeForQuote("Мягкий­перенос и​нулевая ширина")).toBe(
      "мягкийперенос инулевая ширина",
    );
  });

  it("считает слова по буквам и цифрам, а не по пробелам", () => {
    expect(wordCount("в течение 14 дней, — со дня передачи")).toBe(7);
    expect(wordCount(" … ")).toBe(0);
  });
});

describe("LEGAL-03: isVerbatim — цитата есть в тексте фрагмента", () => {
  it("точный кусок текста проходит; с другими пробелами, кавычками и регистром — тоже", () => {
    expect(isVerbatim("в размере 216 белорусских рублей в месяц", NORM)).toBe(true);
    expect(isVerbatim("В  размере 216 белорусских\nрублей в месяц", NORM)).toBe(true);
    expect(isVerbatim("не превышающей 1308 белорусских рублей", NORM)).toBe(true);
  });

  it("любой непрерывный набор слов исходного текста проходит при произвольных пробелах и кавычках", () => {
    const word = fc.stringMatching(/^[а-яё0-9]{1,8}$/u);
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 2, maxLength: 14 }),
        fc.nat(),
        fc.nat(),
        fc.constantFrom(" ", " ", "  ", "\n"),
        (words, x, y, gap) => {
          const from = x % words.length;
          const to = from + 1 + (y % (words.length - from));
          const source = `«${words.join(gap)}»`;
          const quote = words.slice(from, to).join(" ");
          expect(isVerbatim(quote, source)).toBe(true);
        },
      ),
    );
  });

  it("подмена числа не проходит: 217 вместо 216", () => {
    expect(isVerbatim("в размере 217 белорусских рублей в месяц", NORM)).toBe(false);
  });

  it("число обрезано посреди: «в размере 21» не принимается за «в размере 216»", () => {
    expect(isVerbatim("в размере 21", NORM)).toBe(false);
    expect(isVerbatim("размере 216 белорусских рубле", NORM)).toBe(false);
  });

  it("свойство: слово, обрезанное с любого края, не проходит, если такого слова в тексте нет", () => {
    const word = fc.stringMatching(/^[а-я0-9]{3,9}$/u);
    fc.assert(
      fc.property(fc.uniqueArray(word, { minLength: 2, maxLength: 10 }), fc.nat(), (words, at) => {
        const full = words[at % words.length] ?? "";
        // Обрезанное слово не совпадает ни с одним целым словом текста: значит, оно только часть чужого слова.
        for (const cut of [full.slice(0, -1), full.slice(1)]) {
          fc.pre(!words.includes(cut));
          expect(isVerbatim(cut, words.join(" "))).toBe(false);
        }
      }),
    );
  });

  it("слова не в том порядке и слова, которых нет в тексте, не проходят", () => {
    expect(isVerbatim("рублей белорусских", NORM)).toBe(false);
    expect(isVerbatim("в размере 216 долларов", NORM)).toBe(false);
  });

  it("пустая цитата и цитата из одних знаков не проходят", () => {
    expect(isVerbatim("", NORM)).toBe(false);
    expect(isVerbatim("   ", NORM)).toBe(false);
    expect(isVerbatim(", ;", NORM)).toBe(false);
  });

  it("многоточие склеивает куски по порядку: «в размере 216 … не превышающей 1308»", () => {
    expect(isVerbatim("в размере 216 … не превышающей 1308", NORM)).toBe(true);
    expect(isVerbatim("в размере 216 [...] не превышающей 1308", NORM)).toBe(true);
    expect(isVerbatim("в размере 216 ... не превышающей 1308", NORM)).toBe(true);
    // куски в обратном порядке
    expect(isVerbatim("не превышающей 1308 … в размере 216", NORM)).toBe(false);
    // один из кусков не из текста
    expect(isVerbatim("в размере 216 … не превышающей 9999", NORM)).toBe(false);
  });

  it("P3: кусок цитаты с пропуском короче трёх слов не проходит: «доходы … облагаются» на тексте «доходы не облагаются»", () => {
    expect(isVerbatim("доходы … облагаются", "доходы не облагаются")).toBe(false);
    expect(isVerbatim("в размере … белорусских рублей в месяц", NORM)).toBe(false);
    expect(isVerbatim("в размере 216 … белорусских рублей в месяц", NORM)).toBe(true);
    // Без пропуска короткая цитата по-прежнему сверяется целиком.
    expect(isVerbatim("доходы не облагаются", "доходы не облагаются")).toBe(true);
  });

  it("одно вхождение нельзя использовать дважды: «рублей … рублей» требует двух разных «рублей»", () => {
    expect(isVerbatim("рублей в месяц … рублей в месяц", NORM)).toBe(true);
    expect(isVerbatim("рублей в месяц … рублей в месяц … рублей в месяц", NORM)).toBe(false);
  });
});
