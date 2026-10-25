import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { UNDO_TOAST_MS, UndoToast } from "./UndoToast.tsx";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function renderToast() {
  const onUndo = vi.fn<() => void>();
  const onClose = vi.fn<() => void>();
  renderWithProviders(
    <UndoToast opened message="Записал в «Такси»" onUndo={onUndo} onClose={onClose} />,
  );
  return { onUndo, onClose };
}

describe("P5: UndoToast", () => {
  it("сообщение в живой области и кнопка «Отменить»", () => {
    renderToast();
    expect(screen.getByRole("status")).toHaveTextContent("Записал в «Такси»");
    expect(screen.getByRole("button", { name: "Отменить" })).toBeInTheDocument();
  });

  it("закрывается сам через 5 с", async () => {
    const { onClose } = renderToast();
    await act(async () => {
      vi.advanceTimersByTime(UNDO_TOAST_MS - 1);
    });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("«Отменить» отменяет действие и прячет уведомление", () => {
    const { onUndo, onClose } = renderToast();
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(onUndo).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("WCAG 2.2.1: пока фокус на кнопке, время не идёт", async () => {
    const { onClose } = renderToast();
    fireEvent.focus(screen.getByRole("button", { name: "Отменить" }));
    await act(async () => {
      vi.advanceTimersByTime(UNDO_TOAST_MS * 3);
    });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByRole("button", { name: "Отменить" }));
    await act(async () => {
      vi.advanceTimersByTime(UNDO_TOAST_MS);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("закрытое — ничего не рисует", () => {
    renderWithProviders(
      <UndoToast opened={false} message="—" onUndo={() => {}} onClose={() => {}} />,
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
