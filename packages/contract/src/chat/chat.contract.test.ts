// CHAT-02, ADR-0005: контракт чата — слабые схемы кусков и частей AI SDK (контракт не импортирует ai), строгий вход.
import { describe, expect, it } from "vitest";
import {
  ChatMessage,
  ConversationItem,
  ConversationTitle,
  RunMetadata,
  SendInput,
  UiMessageChunk,
  UiMessagePart,
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

describe("CHAT-03: вложения во входе send", () => {
  const id = "0190f0a0-0000-7000-8000-000000000009";

  it("вложение без текста проходит, пустое сообщение без вложений — нет", () => {
    expect(SendInput.safeParse({ text: "", attachments: [{ kind: "receipt", id }] }).success).toBe(
      true,
    );
    expect(SendInput.safeParse({ text: "", attachments: [] }).success).toBe(false);
    expect(SendInput.safeParse({ text: "  " }).success).toBe(false);
  });

  it("не больше четырёх вложений за сообщение", () => {
    const attachments = Array.from({ length: 5 }, () => ({ kind: "statement", id }));
    expect(SendInput.safeParse({ text: "вот", attachments }).success).toBe(false);
    expect(SendInput.safeParse({ text: "вот", attachments: attachments.slice(0, 4) }).success).toBe(
      true,
    );
  });
});

describe("CHAT-04: часть сохранённого сообщения строгая по реестру частей", () => {
  const id = "0190f0a0-0000-7000-8000-000000000009";
  const chart = {
    kind: "bar",
    title: "Кафе по месяцам",
    unit: "money",
    currency: "BYN",
    labels: ["июн", "июл"],
    series: [{ name: "Кафе", values: [1200, 3400] }],
  };

  it("текст, вызов инструмента и шаг AI SDK проходят как есть (форму проверяет AI SDK)", () => {
    for (const part of [
      { type: "text", text: "Привет" },
      { type: "step-start" },
      { type: "tool-search_transactions", state: "output-available", toolCallId: "c1", input: {} },
    ]) {
      expect(UiMessagePart.safeParse(part).success).toBe(true);
    }
  });

  it("данные-части реестра проходят со своей схемой", () => {
    expect(UiMessagePart.safeParse({ type: "data-chart", data: chart }).success).toBe(true);
    expect(
      UiMessagePart.safeParse({ type: "data-attachment", data: { kind: "receipt", id } }).success,
    ).toBe(true);
    expect(
      UiMessagePart.safeParse({
        type: "data-action-result",
        data: { decisionId: id, status: "no", undoToken: null },
      }).success,
    ).toBe(true);
  });

  it("данные-часть с неверной схемой данных или неизвестного вида не проходит", () => {
    expect(
      UiMessagePart.safeParse({ type: "data-chart", data: { ...chart, series: [] } }).success,
    ).toBe(false);
    expect(UiMessagePart.safeParse({ type: "data-chart", data: { ...chart, x: 1 } }).success).toBe(
      false,
    );
    expect(UiMessagePart.safeParse({ type: "data-unknown", data: {} }).success).toBe(false);
    expect(UiMessagePart.safeParse({ type: "data-chart", data: chart, extra: 1 }).success).toBe(
      false,
    );
  });
});

describe("CHAT-10: сообщение называет версии статей, которые изменились позже", () => {
  it("changedVersionIds необязательны; список не длиннее 200", () => {
    const base = {
      id: "0190f0a0-0000-7000-8000-000000000003",
      role: "assistant" as const,
      parts: [],
      status: "complete" as const,
    };
    expect(ChatMessage.parse(base).changedVersionIds).toBeUndefined();
    expect(ChatMessage.parse({ ...base, changedVersionIds: ["12"] }).changedVersionIds).toEqual([
      "12",
    ]);
    expect(
      ChatMessage.safeParse({
        ...base,
        changedVersionIds: Array.from({ length: 201 }, (_, i) => String(i)),
      }).success,
    ).toBe(false);
  });
});
