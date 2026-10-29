// NFR-19: весь текст — из словарей; ключи типизированы, множественные числа — по правилам русского языка
// (`_one` — 1, 21, 101; `_few` — 2–4, 22; `_many` — 0, 5–20, 25, 111; `_other` — дроби).
import { describe, expect, it } from "vitest";
import { createT } from "./create-t.ts";

const t = createT();

describe("NFR-19: createT — словари ru без React", () => {
  it("находит текст по ключу с пространством имён", () => {
    expect(t("common:relativeDay.today")).toBe("сегодня");
  });

  it("подставляет параметры, а не склеивает строки", () => {
    expect(t("common:relativeDay.inDays", { count: 4 })).toBe("через 4 дн.");
  });

  it("каждый вызов — свой экземпляр: язык одного не меняет другой", () => {
    expect(createT("ru")("common:relativeDay.tomorrow")).toBe("завтра");
  });

  it("несуществующий ключ не компилируется", () => {
    // @ts-expect-error — ключа нет в словаре common: опечатка в ключе ловится компилятором, а не на экране
    expect(t("common:relativeDay.nextWeek")).toBe("relativeDay.nextWeek");
  });

  it("несуществующее пространство имён не компилируется", () => {
    // @ts-expect-error — пространства имён receipts ещё нет: его добавит задача экрана «Чеки и документы»
    expect(t("receipts:title")).toBe("title");
  });
});

describe("NFR-19: множественные числа по-русски", () => {
  it.each([
    [0, "0 операций"],
    [1, "1 операция"],
    [2, "2 операции"],
    [5, "5 операций"],
    [11, "11 операций"],
    [12, "12 операций"],
    [13, "13 операций"],
    [14, "14 операций"],
    [21, "21 операция"],
    [22, "22 операции"],
    [25, "25 операций"],
    [101, "101 операция"],
    [111, "111 операций"],
  ])("%i — «%s»", (count, text) => {
    expect(t("common:count.operations", { count })).toBe(text);
  });

  it("дробь — форма _other с десятичной запятой: «1,5 операции»", () => {
    expect(t("common:count.operations", { count: 1.5 })).toBe("1,5 операции");
  });
});
