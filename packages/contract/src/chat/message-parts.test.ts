// CHAT, ARCHITECTURE §10.3: части сообщения чата — текст модели, шаг агента (подпись — из словаря tools по имени
// инструмента, не от модели) и карточка объекта. Расширения частей — задачи T-006, T-010, T-043.
import { describe, expect, it } from "vitest";
import { ChatMessagePart } from "./message-parts.ts";

const id = "0190f0a0-0000-7000-8000-000000000001";

describe("ChatMessagePart", () => {
  it.each([
    { type: "text", text: "Свободный остаток за сентябрь — 840,00 BYN." },
    { type: "step", tool: "search_transactions" },
    { type: "card", kind: "receipt", id },
  ])("часть $type проходит", (part) => {
    expect(ChatMessagePart.parse(part)).toEqual(part);
  });

  it("неизвестный вид части не проходит", () => {
    expect(ChatMessagePart.safeParse({ type: "image", url: "x" }).success).toBe(false);
  });

  it("шаг с подписью от модели не проходит: подпись — из словаря tools", () => {
    expect(
      ChatMessagePart.safeParse({ type: "step", tool: "search_transactions", label: "Ищу…" })
        .success,
    ).toBe(false);
  });

  it("имя инструмента — snake_case латиницей", () => {
    expect(ChatMessagePart.safeParse({ type: "step", tool: "Поиск" }).success).toBe(false);
  });

  it("карточка — только вид и uuid объекта", () => {
    expect(ChatMessagePart.safeParse({ type: "card", kind: "receipt", id: "42" }).success).toBe(
      false,
    );
  });

  it("текст длиннее 100 000 символов не проходит", () => {
    expect(ChatMessagePart.safeParse({ type: "text", text: "a".repeat(100_001) }).success).toBe(
      false,
    );
  });
});
