import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrowLeftRight, CalendarDays, LayoutGrid, MessageCircle, Wallet } from "lucide-react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { BottomNav } from "./BottomNav.tsx";
import type { ShellNavItem } from "./types.ts";

const tab = (key: string, label: string, icon: ShellNavItem["icon"], active = false) => ({
  key,
  label,
  href: `/${key}`,
  icon,
  active,
});

describe("DES-15: нижняя панель телефона", () => {
  it("Главная · Операции · кнопка посередине · Ассистент · Ещё", () => {
    renderWithProviders(
      <BottomNav
        embedded
        tabs={[
          tab("dashboard", "Главная", LayoutGrid, true),
          tab("operations", "Операции", ArrowLeftRight),
          tab("assistant", "Ассистент", MessageCircle),
        ]}
        more={[tab("accounts", "Счета", Wallet)]}
        center={<button type="button">Чек</button>}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Нижнее меню" });
    expect([...nav.querySelectorAll("a, button")].map((el) => el.textContent)).toEqual([
      "Главная",
      "Операции",
      "Чек",
      "Ассистент",
      "Ещё",
    ]);
    expect(within(nav).getByRole("link", { name: "Главная" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("«Ещё» открывает шторку со всеми прочими разделами", async () => {
    renderWithProviders(
      <BottomNav
        embedded
        tabs={[tab("dashboard", "Главная", LayoutGrid)]}
        more={[tab("accounts", "Счета", Wallet), tab("calendar", "Календарь", CalendarDays)]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Ещё разделы" }));
    const sheet = screen.getByRole("dialog", { name: "Все разделы" });
    expect(
      within(sheet)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Счета", "Календарь"]);
  });

  it("без прочих разделов кнопки «Ещё» нет", () => {
    renderWithProviders(
      <BottomNav embedded tabs={[tab("dashboard", "Главная", LayoutGrid)]} more={[]} />,
    );
    expect(screen.queryByRole("button", { name: "Ещё разделы" })).not.toBeInTheDocument();
  });
});
