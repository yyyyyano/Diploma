// AUTH-05: код восстановления показан целиком и копируется кнопкой «Скопировать» → «Скопировано».
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { RecoveryCode } from "./RecoveryCode.tsx";

describe("AUTH-05: показ кода восстановления", () => {
  it("код виден с подписью; «Скопировать» кладёт его в буфер обмена", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderWithProviders(<RecoveryCode code="KQ7M-4XPD-9TJC-2HWR" />);
    expect(screen.getByText("Код восстановления")).toBeInTheDocument();
    expect(screen.getByText("KQ7M-4XPD-9TJC-2HWR")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Скопировать" }));
    expect(writeText).toHaveBeenCalledWith("KQ7M-4XPD-9TJC-2HWR");
    expect(await screen.findByRole("button", { name: "Скопировано" })).toBeInTheDocument();
  });
});
