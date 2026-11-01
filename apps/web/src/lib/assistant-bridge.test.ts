// CHAT-08: мост «спросить ассистента» — просьба открыть с вопросом, вопрос берётся один раз, страница запоминается.
import { describe, expect, it, vi } from "vitest";
import { createAssistantBridge } from "./assistant-bridge.ts";

describe("CHAT-08: мост «спросить ассистента»", () => {
  it("open растит номер просьбы и оставляет вопрос; слушатель уведомлён", () => {
    const bridge = createAssistantBridge();
    const listener = vi.fn<() => void>();
    bridge.subscribe(listener);
    bridge.open("Что сказано в ст. 210 НК?");
    expect(bridge.getState()).toMatchObject({
      openRequest: 1,
      pendingQuestion: "Что сказано в ст. 210 НК?",
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("вопрос берётся один раз: второй takeQuestion — пусто", () => {
    const bridge = createAssistantBridge();
    bridge.open("вопрос");
    expect(bridge.takeQuestion()).toBe("вопрос");
    expect(bridge.takeQuestion()).toBeUndefined();
  });

  it("open без вопроса стирает прежний неиспользованный вопрос", () => {
    const bridge = createAssistantBridge();
    bridge.open("старый");
    bridge.open();
    expect(bridge.takeQuestion()).toBeUndefined();
    expect(bridge.getState().openRequest).toBe(2);
  });

  it("страница запоминается; тот же контекст слушателей не будит; reset забывает всё", () => {
    const bridge = createAssistantBridge();
    const page = { context: { route: "/home", params: {} }, page: "dashboard" };
    const listener = vi.fn<() => void>();
    bridge.subscribe(listener);
    bridge.rememberPage(page);
    bridge.rememberPage(page);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(bridge.getState().lastPage).toEqual(page);
    bridge.reset();
    expect(bridge.getState()).toMatchObject({ openRequest: 0, lastPage: undefined });
  });

  it("отписка работает", () => {
    const bridge = createAssistantBridge();
    const listener = vi.fn<() => void>();
    const off = bridge.subscribe(listener);
    off();
    bridge.open();
    expect(listener).not.toHaveBeenCalled();
  });
});
