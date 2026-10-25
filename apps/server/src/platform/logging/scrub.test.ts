import { describe, expect, it } from "vitest";
import { scrub } from "./scrub.ts";

describe("OBS-04: scrub вычищает данные, узнаваемые по форме", () => {
  it("email — и латиницей, и кириллицей", () => {
    expect(scrub("нет пользователя ivan.petrov+bank@mail.example.by")).toBe(
      "нет пользователя [email]",
    );
    expect(scrub("адрес иван@почта.бел недоступен")).toBe("адрес [email] недоступен");
  });

  it("номер карты с верной контрольной суммой Луна — слитно, с пробелами и дефисами", () => {
    expect(scrub("карта 4111111111111111 отклонена")).toBe("карта [card] отклонена");
    expect(scrub("карта 4111 1111 1111 1111.")).toBe("карта [card].");
    expect(scrub("5500-0000-0000-0004")).toBe("[card]");
  });

  it("цифры без контрольной суммы Луна (id, метки времени) остаются", () => {
    expect(scrub("заказ 4111111111111112")).toBe("заказ 4111111111111112");
    expect(scrub("1761085800000 мс")).toBe("1761085800000 мс");
  });

  it("IBAN BY — слитно, группами и строчными буквами", () => {
    expect(scrub("счёт BY13NBRB3600900000002Z00AB00")).toBe("счёт [iban]");
    expect(scrub("BY13 NBRB 3600 9000 0000 2Z00 AB00 закрыт")).toBe("[iban] закрыт");
    expect(scrub("by13nbrb3600900000002z00ab00")).toBe("[iban]");
  });

  it.each(["a@b.cc_x@d.ee", "a@b.cc.x@d.ee", "a@b.cc+x@d.ee", "a@b.cc1x@d.ee"])(
    "email вплотную к email (%s) — найдены оба",
    (text) => {
      const result = scrub(text);
      expect(result).toBe("[email][email]");
      expect(result).not.toContain("d.ee");
    },
  );

  it("имя файла из двух склеенных адресов — второй адрес не остаётся", () => {
    expect(scrub("ivan@mail.by_petr@mail.by.pdf")).toBe("[email][email]");
  });

  it("локальная часть длиннее 64 символов маскируется целиком, без хвоста и обрезка", () => {
    const local = "ivan.petrov.".repeat(10);
    expect(scrub(`адрес ${local}@d.ee.`)).toBe("адрес [email].");
    expect(scrub(`a@b.cc_${local}@d.ee`)).toBe("[email][email]");
  });

  it("локальная часть с символами вне BMP маскируется целиком", () => {
    expect(scrub("от 𝒾𝓋𝒶𝓃@d.ee")).toBe("от [email]");
  });

  it.each([
    ["две карты через пробел", "4111 1111 1111 1111 4111 1111 1111 1111", "[card] [card]"],
    ["две карты слитно через дефис", "4111-1111-1111-1111-5500-0000-0000-0004", "[card]-[card]"],
    ["карта и срок действия", "карта 4111 1111 1111 1111 12 27", "карта [card] 12 27"],
    ["цифра перед картой", "п. 7 4111111111111111", "п. 7 [card]"],
    ["не-ASCII цифра перед картой", "٣ 4111 1111 1111 1111", "٣ [card]"],
    ["не-ASCII цифра внутри — не карта", "4111 1111 1111 ٣ 1111", "4111 1111 1111 ٣ 1111"],
  ])("карта в плотном соседстве с цифрами: %s", (_name, text, expected) => {
    expect(scrub(text)).toBe(expected);
  });

  it.each([
    ["два IBAN слитно", "BY13NBRB3600900000002Z00AB00BY13NBRB3600900000002Z00AB00", "[iban][iban]"],
    [
      "два IBAN группами",
      "BY13 NBRB 3600 9000 0000 2Z00 AB00 BY13 NBRB 3600 9000 0000 2Z00 AB00",
      "[iban] [iban]",
    ],
    ["IBAN в имени файла", "statement_BY13NBRB3600900000002Z00AB00.pdf", "statement_[iban].pdf"],
  ])("IBAN в плотном соседстве: %s", (_name, text, expected) => {
    expect(scrub(text)).toBe(expected);
  });

  it.each([
    ["email и карта через «+»", "x@y.zz+4111 1111 1111 1111", "[email]+[card]"],
    ["email и карта вплотную", "ivan@mail.by4111111111111111", "[email][card]"],
    ["email и IBAN вплотную", "x@y.zzBY13NBRB3600900000002Z00AB00", "[email][iban]"],
    ["IBAN и карта вплотную", "BY13NBRB3600900000002Z00AB004111111111111111", "[iban][card]"],
    ["IBAN в локальной части email", "ivan.by13nbrb3600900000002z00ab00@mail.by", "[email]"],
  ])("разные ПД вплотную — ни одна не теряется: %s", (_name, text, expected) => {
    expect(scrub(text)).toBe(expected);
  });

  it.each([
    ["1 млн символов без «@»", "a".repeat(1_000_000)],
    ["«@» через каждые 10 символов", "aaaaaaaaa@".repeat(100_000)],
    ["«@» через каждые 100 символов", `${"a".repeat(99)}@`.repeat(10_000)],
    ["«@» через каждые 1000 символов", `${"a.".repeat(499)}a@`.repeat(1_000)],
    ["локальная часть в 1 млн символов", `${"a".repeat(1_000_000)}@b.cc`],
    ["домен из 500 тыс. меток без зоны", `x@${"a.".repeat(500_000)}`],
    ["1 млн цифр через пробел", "1 ".repeat(500_000)],
    ["1 млн символов «by00»", "by00".repeat(250_000)],
  ])("худший случай — линейное время: %s за ≤ 250 мс", (_name, text) => {
    const started = performance.now();
    scrub(text);
    expect(performance.now() - started).toBeLessThan(250);
  });

  describe("совпадает с эталоном на 20 тыс. случайных строк", () => {
    /** Детерминированный генератор (LCG): тест воспроизводим. */
    function randomTexts(alphabet: readonly string[], seed: number): string[] {
      let state = seed;
      const next = (): number => {
        state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
        return state / 2_147_483_648;
      };
      return Array.from({ length: 20_000 }, () => {
        const length = 1 + Math.floor(next() * 40);
        return Array.from({ length }, () => alphabet[Math.floor(next() * alphabet.length)]).join(
          "",
        );
      });
    }

    it("email — как регэксп без ограничения длины локальной части", () => {
      const reference = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;
      const alphabet = ["a", "b", "_", ".", "+", "-", "%", "@", "@", ".", " ", "я", "𝒾", "!"];
      const texts = randomTexts(alphabet, 7);
      expect(texts.map(scrub)).toEqual(texts.map((text) => text.replace(reference, "[email]")));
    });

    it("карты — как перебор всех цепочек групп слева направо, самая длинная первой", () => {
      const luhn = (digits: string): boolean => {
        if (!/^\d{13,19}$/.test(digits)) return false;
        let sum = 0;
        for (let i = 0; i < digits.length; i += 1) {
          const digit = Number(digits[digits.length - 1 - i]) * (i % 2 === 1 ? 2 : 1);
          sum += digit > 9 ? digit - 9 : digit;
        }
        return sum % 10 === 0;
      };
      const reference = (text: string): string =>
        text.replace(/\p{N}(?:[ -]?\p{N})*/gu, (run) => {
          const parts = run.split(/([ -])/);
          let result = "";
          for (let group = 0; group < parts.length;) {
            let digits = "";
            let card = -1;
            for (let last = group; last < parts.length && digits.length <= 19; last += 2) {
              digits += parts[last] ?? "";
              if (luhn(digits)) card = last;
            }
            const next = card === -1 ? group : card;
            result += (card === -1 ? (parts[group] ?? "") : "[card]") + (parts[next + 1] ?? "");
            group = next + 2;
          }
          return result;
        });
      const digits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
      const alphabet = [...digits, ...digits, ...digits, " ", " ", "-", "٣", "x"];
      const texts = randomTexts(alphabet, 42);
      expect(texts.map(scrub)).toEqual(texts.map(reference));
    });
  });

  it("обычный текст не меняется", () => {
    expect(scrub("connection terminated unexpectedly")).toBe("connection terminated unexpectedly");
  });
});
