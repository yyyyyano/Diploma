// DES-12, LEGAL-02, LAW-32: LawQuote — дословный текст шрифтом законов, источник со ссылкой, редакция и предупреждение.
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { LawQuote } from "./LawQuote.tsx";

const TEXT =
  "Социальные налоговые вычеты предоставляются плательщику при условии представления документов.";

describe("DES-12: LawQuote", () => {
  it("цитата выводится без изменений, источник — ссылкой на pravo.by в новой вкладке", () => {
    renderWithProviders(
      <LawQuote source="НК, ст. 210" href="https://pravo.by/document/?guid=3871&p0=Hk0900071">
        {TEXT}
      </LawQuote>,
    );
    expect(screen.getByText(TEXT).tagName).toBe("BLOCKQUOTE");
    const link = screen.getByRole("link", { name: "НК, ст. 210" });
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("редакция и предупреждение о принятых изменениях — отдельными строками", () => {
    renderWithProviders(
      <LawQuote
        source="НК, ст. 210"
        edition="Редакция по состоянию на 21.10.2026"
        warning="Есть принятые изменения"
      >
        {TEXT}
      </LawQuote>,
    );
    expect(screen.getByText("Редакция по состоянию на 21.10.2026")).toBeInTheDocument();
    expect(screen.getByText("Есть принятые изменения")).toBeInTheDocument();
  });

  it("без ссылки источник — подпись, а не ссылка; цитата — в figure с подписью", () => {
    const { container } = renderWithProviders(
      <LawQuote source="Закон № 90-З, ст. 13">{TEXT}</LawQuote>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("figure figcaption")).toHaveTextContent("Закон № 90-З, ст. 13");
  });
});
