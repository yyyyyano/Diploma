// AGT-06, PROF-04: «да» и текст варианта выбирают вариант вопроса ассистента; неоднозначное — не выбирает.
import { describe, expect, it } from "vitest";
import { matchOption } from "./short-reply.ts";

const options = [
  { label: "Да, состоял", value: "now" },
  { label: "Нет", value: "no" },
];

describe("matchOption", () => {
  it("«да» → вариант, начинающийся с «Да»; «Нет.» → «Нет»", () => {
    expect(matchOption("да", options)?.value).toBe("now");
    expect(matchOption("Да!", options)?.value).toBe("now");
    expect(matchOption("Нет.", options)?.value).toBe("no");
  });

  it("точный текст варианта, регистр и «ё» не важны", () => {
    expect(matchOption("да, СОСТОЯЛ", options)?.value).toBe("now");
  });

  it("два варианта на «да» — неоднозначно: ничего не выбрано", () => {
    const two = [
      { label: "Да, сейчас", value: "now" },
      { label: "Да, раньше", value: "before" },
      { label: "Нет", value: "no" },
    ];
    expect(matchOption("да", two)).toBeUndefined();
    expect(matchOption("да, раньше", two)?.value).toBe("before");
  });

  it("развёрнутый ответ — это уже вопрос агенту, а не выбор варианта", () => {
    expect(matchOption("да, но в августе", options)).toBeUndefined();
    expect(matchOption("не знаю", options)).toBeUndefined();
  });

  it("вариантов нет — ничего не выбрано", () => {
    expect(matchOption("да", [])).toBeUndefined();
  });
});
