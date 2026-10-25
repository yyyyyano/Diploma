import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { WhyButton } from "./WhyButton.tsx";

describe("P2: WhyButton «Откуда эта цифра?»", () => {
  it("настоящая кнопка с названием числа в подписи", () => {
    renderWithProviders(<WhyButton subject="Свободный остаток" onClick={() => {}} />);
    const button = screen.getByRole("button", { name: "Откуда эта цифра: Свободный остаток" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("нажимается с клавиатуры — Enter открывает объяснение", async () => {
    const onClick = vi.fn<() => void>();
    renderWithProviders(<WhyButton subject="Расходы за месяц" onClick={onClick} />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
