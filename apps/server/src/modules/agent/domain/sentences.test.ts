// AGT-04: ответ выводится по предложениям — граница не там, где точка в «ст. 210», дроби, списке и после «руб.».
import { describe, expect, it } from "vitest";
import { createSentenceSplitter } from "./sentences.ts";

/** Весь текст кусками по `size` знаков: предложения и остаток. */
function split(text: string, size = 3): string[] {
  const splitter = createSentenceSplitter();
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(...splitter.push(text.slice(i, i + size)));
  const rest = splitter.flush();
  if (rest !== undefined) out.push(rest);
  return out;
}

describe("предложения", () => {
  it("два предложения, пробел остаётся у первого", () => {
    expect(split("Записал трату. Остаток 5 BYN.")).toEqual(["Записал трату. ", "Остаток 5 BYN."]);
  });

  it("не зависит от размера кусков потока: сложенные куски дают исходный текст", () => {
    const text = "Раз. Два! Три? Четыре… Пять\nШесть.";
    for (const size of [1, 2, 3, 7, 100]) expect(split(text, size).join("")).toBe(text);
    expect(split(text, 1)).toEqual(split(text, 100));
  });

  it("«ст. 210», «п. 1.1» и дробь «2,49» границей не считаются", () => {
    expect(split("Смотрите ст. 210 НК, п. 1.1 и цену 2.49 BYN. Далее.")).toEqual([
      "Смотрите ст. 210 НК, п. 1.1 и цену 2.49 BYN. ",
      "Далее.",
    ]);
  });

  it("«руб.» перед заглавной — граница, перед строчной — нет", () => {
    expect(split("Заплатили 500 руб. Это много.")).toEqual(["Заплатили 500 руб. ", "Это много."]);
    expect(split("Заплатили 500 руб. в месяц.")).toEqual(["Заплатили 500 руб. в месяц."]);
  });

  it("перевод строки — конец предложения; нумерация «1.» списка границей не считается", () => {
    expect(split("Итоги:\n1. Такси\n2. Кафе")).toEqual(["Итоги:\n", "1. Такси\n", "2. Кафе"]);
  });

  it("кавычка и скобка после точки остаются в предложении", () => {
    expect(split("Он сказал «да». Потом ушёл (быстро.) Конец.")).toEqual([
      "Он сказал «да». ",
      "Потом ушёл (быстро.) ",
      "Конец.",
    ]);
  });

  it("остаток без точки отдаёт flush; пустой поток — ничего", () => {
    const splitter = createSentenceSplitter();
    expect(splitter.push("Без точки")).toEqual([]);
    expect(splitter.flush()).toBe("Без точки");
    expect(splitter.flush()).toBeUndefined();
  });

  it("точка в конце потока ждёт следующий кусок: «2026.» ещё может стать «2026.5»", () => {
    const splitter = createSentenceSplitter();
    expect(splitter.push("Итого 2026.")).toEqual([]);
    expect(splitter.push("5 BYN. ")).toEqual(["Итого 2026.5 BYN. "]);
  });
});
