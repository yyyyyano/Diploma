// XLS-01, AGT-03, CHAT-04: карточка результата `export_excel` — период, число операций и ссылка «Скачать Excel»; не по схеме — запасная.
import { assistantTexts } from "@kosht/i18n";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../../test/render.tsx";
import { ExcelCard } from "./ExcelCard.tsx";

const OUTPUT = {
  from: "2026-09-01",
  to: "2026-09-30",
  operations: 47,
  url: "/api/xls-export?from=2026-09-01&to=2026-09-30",
};

describe("XLS-01, CHAT-04: карточка Excel в чате", () => {
  it("показывает период и число операций, ссылка скачивает файл", () => {
    renderWithProviders(<ExcelCard output={OUTPUT} />);
    expect(screen.getByText("Файл Excel за 01.09.2026 — 30.09.2026")).toBeInTheDocument();
    expect(screen.getByText(/Операций в файле: 47/u)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Скачать Excel" });
    expect(link).toHaveAttribute("href", OUTPUT.url);
    expect(link).toHaveAttribute("download");
  });

  it("результат не по схеме — «Карточка недоступна», без ссылки", () => {
    renderWithProviders(<ExcelCard output={{ url: 5 }} />);
    expect(screen.getByText(assistantTexts.cards.unavailable)).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
