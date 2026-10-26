// AGT-07, ARCHITECTURE §5: короткое «да / нет» текстом распознаётся кодом; всё длиннее — вопрос агенту.
import { describe, expect, it } from "vitest";
import { parseShortAnswer } from "./short-answer.ts";

describe("AGT-07: короткий ответ на ожидающее решение", () => {
  it.each(["да", "Да!", "  ДА.  ", "ага", "конечно", "давай", "так", "Да, давай!", "ок"])(
    "«%s» — да",
    (text) => {
      expect(parseShortAnswer(text)).toBe("yes");
    },
  );

  it.each(["нет", "Нет.", "не надо", "отмена", "НЕТ!!!", "не трэба"])("«%s» — нет", (text) => {
    expect(parseShortAnswer(text)).toBe("no");
  });

  it.each(["да, но в августе", "нет, перенеси в такси", "сколько я потратил?", "", "данет"])(
    "«%s» — не короткий ответ",
    (text) => {
      expect(parseShortAnswer(text)).toBeUndefined();
    },
  );
});
