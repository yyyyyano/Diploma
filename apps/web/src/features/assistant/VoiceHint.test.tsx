// VOICE-02: по сети вместо микрофона — подсказка «Надиктуйте в Telegram»; закрывается.
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { VoiceHint } from "./VoiceHint.tsx";

describe("VOICE-02: подсказка вместо микрофона", () => {
  it("объясняет, почему микрофона нет, и зовёт в Telegram", () => {
    renderWithProviders(<VoiceHint />);
    expect(screen.getByRole("note")).toHaveTextContent(
      "Голосовой ввод здесь недоступен: по сети микрофон работает только на компьютере. Надиктуйте в Telegram",
    );
  });

  it("закрывается кнопкой", async () => {
    renderWithProviders(<VoiceHint />);
    await userEvent.click(screen.getByRole("button", { name: "Закрыть подсказку" }));
    expect(screen.queryByRole("note")).toBeNull();
  });
});
