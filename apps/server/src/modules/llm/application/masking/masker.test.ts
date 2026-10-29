// PRIV-03, КП PRIV: маскировщик — в облако уходит текст с метками, ответ демаскируется локально; суммы, даты, магазины
// остаются. Данные синтетические (NFR-18).
import { testScope } from "@kosht/testing";
import { describe, expect, it } from "vitest";
import { createMasker } from "./masker.ts";
import { createRedactions } from "./redactions.ts";
import type { NameRecognizer } from "./ports.ts";

const scope = testScope();
const names = (...list: string[]) => ({ names: async () => list });

const STATEMENT =
  "21.10.2026 Перевод Иванова Сергея Петровича на счёт BY20 AKBB 3012 0000 0418 8000 0000, " +
  "карта 4111 1111 1111 1111, тел. +375 (29) 123-45-67, 150,00 BYN, Евроопт";

describe("КП PRIV: в запросе к облаку нет номера счёта, ФИО и телефона из выписки", () => {
  it("метки вместо личного; суммы, даты и магазин на месте", async () => {
    const masker = createMasker({ names: names("Сергей Иванов") });
    const { text } = await masker.mask(scope, STATEMENT);
    expect(text).toBe(
      "21.10.2026 Перевод [ИМЯ_1] [ИМЯ_2] Петровича на счёт [СЧЁТ_1], карта [КАРТА_1], тел. [ТЕЛЕФОН_1], 150,00 BYN, Евроопт",
    );
    for (const secret of ["Иванова", "Сергея", "BY20", "4111", "123-45-67"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("ответ модели с метками демаскируется настоящими значениями", async () => {
    const masker = createMasker({ names: names("Сергей Иванов") });
    const { text, replacements } = await masker.mask(scope, STATEMENT);
    expect(text).toContain("[СЧЁТ_1]");
    const answer =
      "Перевод на [СЧЁТ_1] сделан для [ИМЯ_2]; [ЭТОТ_9] не метка, [СЧЁТ_7] неизвестна.";
    expect(masker.unmask(answer, replacements)).toBe(
      "Перевод на BY20 AKBB 3012 0000 0418 8000 0000 сделан для Сергея; [ЭТОТ_9] не метка, [СЧЁТ_7] неизвестна.",
    );
  });
});

describe("сессия: сквозные метки на один вызов модели", () => {
  it("одно значение — одна метка во всех кусках промпта; регистр и пробелы в номере не важны", async () => {
    const session = createMasker({ names: names("Анна") }).session(scope);
    expect(await session.mask("Для Анна: BY20 AKBB 3012 0000 0418 8000 0000")).toBe(
      "Для [ИМЯ_1]: [СЧЁТ_1]",
    );
    expect(await session.mask("Снова by20akbb30120000041880000000 и Анна")).toBe(
      "Снова [СЧЁТ_1] и [ИМЯ_1]",
    );
    expect([...session.replacements]).toEqual([
      ["[ИМЯ_1]", "Анна"],
      ["[СЧЁТ_1]", "BY20 AKBB 3012 0000 0418 8000 0000"],
    ]);
  });

  it("имя в разных падежах — разные метки, у каждой своя исходная форма", async () => {
    const masker = createMasker({ names: names("Анна") });
    const { text, replacements } = await masker.mask(scope, "Анна дала Анне, а Анну позвали");
    expect(text).toBe("[ИМЯ_1] дала [ИМЯ_2], а [ИМЯ_3] позвали");
    expect(masker.unmask(text, replacements)).toBe("Анна дала Анне, а Анну позвали");
  });

  it("словарь имён спрашивается один раз за сессию и только у владельца scope", async () => {
    const asked: string[] = [];
    const masker = createMasker({
      names: {
        names: async (who) => {
          asked.push(who.userId);
          return ["Анна"];
        },
      },
    });
    const session = masker.session(scope);
    await session.mask("Анна");
    await session.mask("Анна");
    expect(asked).toEqual([scope.userId]);
  });
});

describe("NER и деградация", () => {
  const recognizer: NameRecognizer = {
    recognize: async (text) => {
      const start = text.indexOf("Лукашевич");
      return start === -1 ? [] : [{ start, end: start + "Лукашевич".length, kind: "name" }];
    },
  };

  it("чужое имя, которого нет в словаре, ловит NER; без NER остаются правила и словарь", async () => {
    const withNer = createMasker({ names: names(), recognizer });
    expect((await withNer.mask(scope, "Лукашевич и BY20 AKBB 3012 0000 0418 8000 0000")).text).toBe(
      "[ИМЯ_1] и [СЧЁТ_1]",
    );
    const without = createMasker({ names: names() });
    expect((await without.mask(scope, "Лукашевич и BY20 AKBB 3012 0000 0418 8000 0000")).text).toBe(
      "Лукашевич и [СЧЁТ_1]",
    );
  });
});

describe("реестр замен для трасс (OBS-03)", () => {
  it("значения, заменённые метками, запоминаются на срок и заменяются в тексте трасс; срок вышел — забыты", async () => {
    let now = 0;
    const redactions = createRedactions(() => now, 1000);
    const masker = createMasker({ names: names("Анна"), redactions });
    await masker.mask(scope, "Анна, BY20 AKBB 3012 0000 0418 8000 0000");
    expect(redactions.apply("в трассе: Анна и BY20 AKBB 3012 0000 0418 8000 0000")).toBe(
      "в трассе: [ИМЯ_1] и [СЧЁТ_1]",
    );
    now = 1001;
    expect(redactions.apply("Анна")).toBe("Анна");
    expect(redactions.size).toBe(0);
  });

  it("длинное значение заменяется раньше короткого: «Иванова» не оставляет хвост «Иванов»", () => {
    const redactions = createRedactions(() => 0);
    redactions.remember("Иванов", "[ИМЯ_1]");
    redactions.remember("Иванова", "[ИМЯ_2]");
    expect(redactions.apply("Иванова и Иванов")).toBe("[ИМЯ_2] и [ИМЯ_1]");
  });
});
