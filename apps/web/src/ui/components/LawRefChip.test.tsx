// DES-06, NFR-20: LawRefChip — подпись текстом, со ссылкой — настоящая `<a>`; внешняя открывается в новой вкладке.
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { LawRefChip } from "./LawRefChip.tsx";

describe("DES-06: LawRefChip", () => {
  it("без ссылки — подпись и скрытый от диктора значок", () => {
    const { container } = renderWithProviders(<LawRefChip label="ст. 210 НК" />);
    expect(screen.getByText("ст. 210 НК")).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("со ссылкой — `<a>` с адресом; внешняя — новая вкладка и rel без утечки", () => {
    renderWithProviders(
      <LawRefChip
        label="Закон № 90-З"
        href="https://pravo.by/document/?guid=3871&p0=H10200090"
        external
      />,
    );
    const link = screen.getByRole("link", { name: "Закон № 90-З" });
    expect(link).toHaveAttribute("href", "https://pravo.by/document/?guid=3871&p0=H10200090");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("внутренняя ссылка — без новой вкладки", () => {
    renderWithProviders(<LawRefChip label="ст. 13 ЗоЗПП" href="/laws/H10200090?article=13" />);
    expect(screen.getByRole("link")).not.toHaveAttribute("target");
  });
});
