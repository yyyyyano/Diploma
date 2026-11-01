// VOICE-02, CHAT-07: поле вопроса — отправка и «Остановить», микрофон только когда доступен, состояние записи и ошибки
// голоса в живой области. Сам голосовой ввод — подмена (звука в тестах нет).
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { Composer, type ComposerProps } from "./Composer.tsx";
import type { VoiceInput } from "./model/use-voice-input.ts";

function voice(over: Partial<VoiceInput> = {}): VoiceInput {
  return {
    mode: "available",
    status: "idle",
    error: undefined,
    retryAfterMinutes: 1,
    start: vi.fn<() => void>(),
    stop: vi.fn<() => void>(),
    clearError: vi.fn<() => void>(),
    ...over,
  };
}

function setup(over: Partial<ComposerProps> = {}) {
  const props: ComposerProps = {
    value: "Потратил 15 рублей на кофе",
    onChange: vi.fn<(value: string) => void>(),
    onSubmit: vi.fn<() => void>(),
    busy: false,
    onStop: undefined,
    voice: voice(),
    placeholder: "Спросите…",
    ...over,
  };
  renderWithProviders(<Composer {...props} />);
  return props;
}

describe("CHAT-02: отправка", () => {
  it("Enter отправляет, Shift+Enter — перенос строки; кнопка «Отправить» тоже", async () => {
    const props = setup();
    const field = screen.getByRole("textbox", { name: "Вопрос ассистенту" });
    await userEvent.type(field, "{Shift>}{Enter}{/Shift}");
    expect(props.onSubmit).not.toHaveBeenCalled();
    await userEvent.type(field, "{Enter}");
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(props.onSubmit).toHaveBeenCalledTimes(2);
  });

  it("пустой вопрос не отправляется: кнопка неактивна", () => {
    setup({ value: "   " });
    expect(screen.getByRole("button", { name: "Отправить" })).toBeDisabled();
  });

  it("пока ответ идёт — «Остановить ответ» вместо «Отправить»; остановить нечем — «Отправить» неактивна", async () => {
    const onStop = vi.fn<() => void>();
    const first = setup({ busy: true, onStop });
    await userEvent.click(screen.getByRole("button", { name: "Остановить ответ" }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(first.onSubmit).not.toHaveBeenCalled();
  });
});

describe("VOICE-02: микрофон", () => {
  it("доступен — кнопка «Надиктовать вопрос» запускает запись", async () => {
    const mic = voice();
    setup({ voice: mic });
    await userEvent.click(screen.getByRole("button", { name: "Надиктовать вопрос" }));
    expect(mic.start).toHaveBeenCalledTimes(1);
  });

  it("идёт запись — кнопка «Остановить запись» (нажата), в живой области — что происходит", async () => {
    const mic = voice({ status: "recording" });
    setup({ voice: mic });
    const stop = screen.getByRole("button", { name: "Остановить запись" });
    expect(stop).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Идёт запись… Нажмите, чтобы остановить.");
    await userEvent.click(stop);
    expect(mic.stop).toHaveBeenCalledTimes(1);
  });

  it("распознаётся — кнопка неактивна, «Распознаю речь…»", () => {
    setup({ voice: voice({ status: "working" }) });
    expect(screen.getByRole("button", { name: "Надиктовать вопрос" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Распознаю речь…");
  });

  it.each(["network", "unsupported"] as const)("режим %s — кнопки микрофона нет", (mode) => {
    setup({ voice: voice({ mode }) });
    expect(screen.queryByRole("button", { name: /Надиктовать|Остановить запись/ })).toBeNull();
  });

  it("ошибка голоса — в сообщении role=alert; «слишком часто» — с минутами", () => {
    setup({ voice: voice({ error: "rateLimited", retryAfterMinutes: 3 }) });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Слишком много записей подряд. Попробуйте через 3 мин.",
    );
  });
});
