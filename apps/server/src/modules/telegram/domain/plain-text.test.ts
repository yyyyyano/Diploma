// SEC-05: Markdown ответа модели — в обычный текст; разметка, разорванная между кусками потока, тоже убирается.
import { describe, expect, it } from "vitest";
import { createPlainTextStream, plainText } from "./plain-text.ts";

function through(chunks: string[]): string {
  const stream = createPlainTextStream();
  return chunks.map((chunk) => stream.push(chunk)).join("") + stream.end();
}

describe("Markdown → обычный текст для Telegram", () => {
  it("убирает жирный, курсив-подчёркивание, код и заголовки", () => {
    expect(plainText("## Итог\nВы потратили **412,30 BYN** на `кафе`.")).toBe(
      "Итог\nВы потратили 412,30 BYN на кафе.",
    );
  });

  it("«**», разорванное между кусками, не просачивается", () => {
    expect(through(["Вы потратили *", "*412,30", " BYN*", "* всего"])).toBe(
      "Вы потратили 412,30 BYN всего",
    );
  });

  it("заголовок в начале строки убирается и в потоке, посреди строки «#» остаётся", () => {
    expect(through(["Итог\n#", "# Раздел\nномер #5"])).toBe("Итог\nРаздел\nномер #5");
  });

  it("хвост из одной «*» в конце потока уходит как есть", () => {
    expect(through(["умножить 2 *"])).toBe("умножить 2 *");
  });

  it("сырой HTML не превращается в разметку: текст остаётся текстом", () => {
    expect(plainText("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});
