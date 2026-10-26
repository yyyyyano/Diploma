import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { GalleryPage } from "./GalleryPage.tsx";

describe("витрина /dev/gallery", () => {
  it("один заголовок страницы и раздел на каждую группу компонентов", () => {
    renderWithProviders(<GalleryPage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const sections = screen
      .getAllByRole("region")
      .map((region) => region.getAttribute("aria-labelledby"));
    expect(sections).toEqual([
      "money-title",
      "why-title",
      "badges-title",
      "logo-title",
      "stat-title",
      "states-title",
      "overlays-title",
      "shell-title",
      "phone-title",
    ]);
  });

  it("каркас: меню DES-15 целиком и нижняя панель с кнопкой «Чек»", () => {
    renderWithProviders(<GalleryPage />);
    const menu = screen.getByRole("navigation", { name: "Разделы" });
    expect(within(menu).getAllByRole("link")).toHaveLength(14);
    const bottom = screen.getByRole("navigation", { name: "Нижнее меню" });
    expect(
      [...bottom.querySelectorAll(":scope > a, :scope > button")].map((el) => el.textContent),
    ).toEqual(["Главная", "Операции", "Чек", "Ассистент", "Ещё"]);
  });

  it("панель, подтверждение и уведомление открываются кнопками", async () => {
    renderWithProviders(<GalleryPage />);
    await userEvent.click(screen.getByRole("button", { name: "Открыть панель" }));
    const panel = screen.getByRole("dialog", { name: "Откуда эта цифра?" });
    // EXPL-01: формула свободного остатка из подписей словаря formulas.
    expect(panel).toHaveTextContent("Средний регулярный доход");
    expect(panel).toHaveTextContent("Подписки и онлайн-сервисы");
    expect(panel).toHaveTextContent("Период: 01.07.2026 — 30.09.2026");
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: "Подтверждение удаления" }));
    await userEvent.click(screen.getByRole("button", { name: "Да, удалить 3" }));
    expect(screen.getByText("Последнее действие: Удалено 3")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Уведомление с отменой" }));
    await userEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(screen.getByText("Последнее действие: Отменено")).toBeInTheDocument();
  });
});
