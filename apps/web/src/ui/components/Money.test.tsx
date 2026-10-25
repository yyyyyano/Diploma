import { Money as M } from "@kosht/kernel";
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { Money } from "./Money.tsx";

const NBSP = String.fromCharCode(0x00a0);
const MINUS = String.fromCharCode(0x2212);

/** Текст суммы — без служебного <style> провайдера Mantine. */
function text(container: HTMLElement): string {
  return container.querySelector(":scope > span")?.textContent ?? "";
}

describe("DES-17: Money", () => {
  it("1 234,56 BYN — неразрывные пробелы, код валюты отдельным мелким элементом", () => {
    const { container } = renderWithProviders(<Money value={M.of(123_456, "BYN")} />);
    expect(text(container)).toBe(`1${NBSP}234,56${NBSP}BYN`);
    expect(screen.getByText("BYN", { exact: false }).tagName).toBe("SPAN");
  });

  it("доход — со знаком «+»", () => {
    const { container } = renderWithProviders(<Money value={M.of(97_240, "BYN")} kind="income" />);
    expect(text(container)).toBe(`+972,40${NBSP}BYN`);
  });

  it("расход — с минусом U+2212, даже если сумма пришла положительной", () => {
    const { container } = renderWithProviders(<Money value={M.of(3290, "BYN")} kind="expense" />);
    expect(text(container)).toBe(`${MINUS}32,90${NBSP}BYN`);
  });

  it("расход, пришедший отрицательным, не получает двойной минус", () => {
    const { container } = renderWithProviders(<Money value={M.of(-3290, "BYN")} kind="expense" />);
    expect(text(container)).toBe(`${MINUS}32,90${NBSP}BYN`);
  });

  it("перевод — без знака, со значком и словом «перевод» для экранного диктора (не только цветом)", () => {
    const { container } = renderWithProviders(
      <Money value={M.of(10_000, "BYN")} kind="transfer" />,
    );
    expect(text(container)).toBe(`перевод100,00${NBSP}BYN`);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("ноль — без знака у дохода и расхода", () => {
    const { container } = renderWithProviders(<Money value={M.of(0, "BYN")} kind="income" />);
    expect(text(container)).toBe(`0,00${NBSP}BYN`);
  });

  it("без kind знак — как у числа", () => {
    const { container } = renderWithProviders(<Money value={M.of(-84_000, "USD")} />);
    expect(text(container)).toBe(`${MINUS}840,00${NBSP}USD`);
  });

  it("DES-07: tabular включает табличные цифры, без него — пропорциональные", () => {
    const { container } = renderWithProviders(
      <>
        <Money value={M.of(100, "BYN")} tabular />
        <Money value={M.of(100, "BYN")} />
      </>,
    );
    const [tabular, proportional] = [...container.querySelectorAll(":scope > span")];
    expect(tabular?.className).toMatch(/tabular/);
    expect(proportional?.className).not.toMatch(/tabular/);
  });
});
