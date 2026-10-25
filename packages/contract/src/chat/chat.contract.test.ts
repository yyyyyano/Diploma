// CHAT-02, ADR-0005: контракт чата — слабые схемы кусков и частей AI SDK (контракт не импортирует ai), строгий вход.
import { describe, expect, it } from "vitest";
import { RunMetadata, SendInput, UiMessageChunk } from "./chat.contract.ts";

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
