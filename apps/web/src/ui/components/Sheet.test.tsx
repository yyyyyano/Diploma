import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { Sheet } from "./Sheet.tsx";

describe("Sheet — боковая панель", () => {
  it("открытая — диалог с заголовком и кнопкой «Закрыть»", () => {
    renderWithProviders(
      <Sheet opened onClose={() => {}} title="Откуда эта цифра">
        Формула
      </Sheet>,
    );
    expect(screen.getByRole("dialog", { name: "Откуда эта цифра" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeInTheDocument();
  });

  it("Esc закрывает панель", async () => {
    const onClose = vi.fn<() => void>();
    renderWithProviders(
      <Sheet opened onClose={onClose} title="Операция">
        Карточка
      </Sheet>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("закрытая — ничего не рисует", () => {
    renderWithProviders(
      <Sheet opened={false} onClose={() => {}} title="Операция">
        Карточка
      </Sheet>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
