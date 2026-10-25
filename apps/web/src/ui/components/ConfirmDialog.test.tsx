import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

function renderDialog(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn<() => void>();
  const onCancel = vi.fn<() => void>();
  renderWithProviders(
    <ConfirmDialog
      opened
      title="Перенести 13 операций?"
      confirmLabel="Да, перенести 13"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    >
      <ul>
        <li>Категория «Такси» → «Транспорт»</li>
      </ul>
    </ConfirmDialog>,
  );
  return { onConfirm, onCancel };
}

describe("P5: ConfirmDialog", () => {
  it("диалог с перечнем изменений и кнопкой-глаголом", async () => {
    const { onConfirm } = renderDialog();
    expect(screen.getByRole("dialog", { name: "Перенести 13 операций?" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("«Такси» → «Транспорт»");
    await userEvent.click(screen.getByRole("button", { name: "Да, перенести 13" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("«Отмена» и Esc отменяют, а не подтверждают", async () => {
    const { onConfirm, onCancel } = renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));
    await userEvent.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("пока действие выполняется, «Отмена» недоступна, повторное подтверждение не уходит", async () => {
    const { onConfirm } = renderDialog({ pending: true });
    expect(screen.getByRole("button", { name: "Отмена" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: /Да, перенести 13/ }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
