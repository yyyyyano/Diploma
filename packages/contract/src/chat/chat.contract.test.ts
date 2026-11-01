// CHAT-02, ADR-0005: контракт чата — слабые схемы кусков и частей AI SDK (контракт не импортирует ai), строгий вход.
import { describe, expect, it } from "vitest";
import {
  ChatMessage,
  ConversationItem,
  ConversationTitle,
  RunMetadata,
  SendInput,
  UiMessageChunk,
} from "./chat.contract.ts";

describe("CHAT-02: поток ответа", () => {
  it("кусок — любой объект с type (форму проверяет AI SDK на сайте)", () => {
    const chunk = { type: "text-delta", id: "t1", delta: "Вот" };
    expect(UiMessageChunk.parse(chunk)).toEqual(chunk);
    expect(UiMessageChunk.safeParse({ delta: "без типа" }).success).toBe(false);
  });

  it("метаданные запуска — runId и id диалога (uuid)", () => {
    const meta = {
      runId: "0190f0a0-0000-7000-8000-000000000001",
      conversationId: "0190f0a0-0000-7000-8000-000000000002",
    };
    expect(RunMetadata.parse(meta)).toEqual(meta);
  });
});

describe("вход send", () => {
  it("текст обрезается по краям; пустой и длиннее 4000 — не проходит; владельца во входе нет", () => {
    expect(SendInput.parse({ text: "  Какие у меня счета?  " })).toEqual({
      text: "Какие у меня счета?",
    });
    for (const input of [
      { text: "   " },
      { text: "я".repeat(4001) },
      { text: "x", householdId: "чужое" },
    ]) {
      expect(SendInput.safeParse(input).success).toBe(false);
    }
  });
});

describe("CHAT-08: контекст страницы во входе send", () => {
  it("страница с периодом проходит; лишнее поле и путь без «/» — нет", () => {
    const page = { route: "/home", params: { period: "2026-09" } };
    expect(SendInput.parse({ text: "почему так много на такси?", page }).page).toEqual(page);
    expect(SendInput.safeParse({ text: "x", page: { ...page, owner: "чужой" } }).success).toBe(
      false,
    );
    expect(SendInput.safeParse({ text: "x", page: { route: "home", params: {} } }).success).toBe(
      false,
    );
  });
});

describe("CHAT-01: диалоги", () => {
  it("название обрезается по краям, пустое и длиннее 100 знаков — нет", () => {
    expect(ConversationTitle.parse("  Вычет за учёбу  ")).toBe("Вычет за учёбу");
    expect(ConversationTitle.safeParse("   ").success).toBe(false);
    expect(ConversationTitle.safeParse("я".repeat(101)).success).toBe(false);
  });

  it("строка списка — id, название (может быть null), время ISO и начало сообщения", () => {
    const item = {
      id: "0190f0a0-0000-7000-8000-000000000002",
      title: null,
      updatedAt: "2026-10-31T09:00:00.000Z",
      preview: "Записал: кафе, 15,00 BYN",
    };
    expect(ConversationItem.parse(item)).toEqual(item);
    expect(ConversationItem.safeParse({ ...item, updatedAt: "вчера" }).success).toBe(false);
  });
});

describe("LLM-10: кто ответил хранится с сообщением", () => {
  it("answeredBy — модель и недоступные; необязательно", () => {
    const base = {
      id: "0190f0a0-0000-7000-8000-000000000003",
      role: "assistant" as const,
      parts: [],
      status: "complete" as const,
    };
    expect(ChatMessage.parse(base).answeredBy).toBeUndefined();
    const answeredBy = { model: "zai/glm-4.7-flash", unavailable: ["groq/llama-3.3-70b"] };
    expect(ChatMessage.parse({ ...base, answeredBy }).answeredBy).toEqual(answeredBy);
  });
});
