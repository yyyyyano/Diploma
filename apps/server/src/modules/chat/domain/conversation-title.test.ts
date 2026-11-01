// CHAT-01: название диалога без модели — первое сообщение по границе слова, не длиннее 60 знаков.
import { describe, expect, it } from "vitest";
import { conversationTitle, TITLE_MAX } from "./conversation-title.ts";

describe("CHAT-01: название диалога", () => {
  it("короткое сообщение — само название, лишние пробелы и переводы строк свёрнуты", () => {
    expect(conversationTitle("  Потратил 15 рублей\nна кофе  ")).toBe("Потратил 15 рублей на кофе");
  });

  it("ровно 60 знаков — без многоточия", () => {
    const text = "а".repeat(30) + " " + "б".repeat(29);
    expect(text).toHaveLength(60);
    expect(conversationTitle(text)).toBe(text);
  });

  it("длинное — обрезано по слову, с многоточием, не длиннее 60", () => {
    const title = conversationTitle(
      "Сколько я потратил на кафе за лето и сколько сэкономлю за год, если урежу на треть?",
    );
    expect(title).toBe("Сколько я потратил на кафе за лето и сколько сэкономлю за…");
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
  });

  it("слово не рвётся посередине: после обрезки последнее слово целое", () => {
    const title = conversationTitle("слово ".repeat(20));
    expect(title.endsWith("слово…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX);
  });

  it("одно длинное слово без пробелов (ссылка) режется жёстко", () => {
    const title = conversationTitle("x".repeat(200));
    expect(title).toBe(`${"x".repeat(TITLE_MAX - 1)}…`);
  });
});
