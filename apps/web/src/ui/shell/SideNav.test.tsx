import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ArrowLeftRight, LayoutGrid, Wallet } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../test/render.tsx";
import { initials, SideNav } from "./SideNav.tsx";
import type { ShellNavGroup } from "./types.ts";

const groups: ShellNavGroup[] = [
  {
    key: "main",
    items: [{ key: "dashboard", label: "Главная", href: "/", icon: LayoutGrid, active: false }],
  },
  {
    key: "money",
    label: "Деньги",
    items: [
      {
        key: "operations",
        label: "Операции",
        href: "/operations",
        icon: ArrowLeftRight,
        active: true,
      },
      { key: "accounts", label: "Счета", href: "/accounts", icon: Wallet, active: false },
    ],
  },
];

describe("DES-15: боковое меню", () => {
  it("меню — область «Основное меню» с навигацией «Разделы» и подписями групп", () => {
    renderWithProviders(<SideNav groups={groups} homeHref="/" />);
    const nav = within(screen.getByRole("complementary", { name: "Основное меню" })).getByRole(
      "navigation",
      { name: "Разделы" },
    );
    expect(
      within(nav)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Главная", "Операции", "Счета"]);
    expect(within(nav).getByText("Деньги")).toBeInTheDocument();
  });

  it("текущий раздел отмечен aria-current=page, остальные — нет", () => {
    renderWithProviders(<SideNav groups={groups} homeHref="/" />);
    expect(screen.getByRole("link", { name: "Операции" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Счета" })).not.toHaveAttribute("aria-current");
  });

  it("логотип — ссылка на главную с понятной подписью", () => {
    renderWithProviders(<SideNav groups={[]} homeHref="/" />);
    expect(screen.getByRole("link", { name: "Кошт — на главную" })).toHaveAttribute("href", "/");
  });

  it("без пунктов (фичи ещё не готовы) навигации нет вовсе", () => {
    renderWithProviders(<SideNav groups={[]} homeHref="/" />);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("переход — через обработчик роутера; с Ctrl — браузеру (новая вкладка)", async () => {
    const onNavigate = vi.fn<(href: string) => void>((_href) => undefined);
    renderWithProviders(
      <SideNav
        groups={groups}
        homeHref="/"
        onNavigate={(href, event) => {
          event.preventDefault();
          onNavigate(href);
        }}
      />,
    );
    await userEvent.click(screen.getByRole("link", { name: "Счета" }));
    expect(onNavigate).toHaveBeenCalledWith("/accounts");
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(screen.getByRole("link", { name: "Операции" }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("пользователь и «Выйти» — кнопка с подписью", async () => {
    const onLogout = vi.fn<() => void>();
    renderWithProviders(
      <SideNav
        groups={groups}
        homeHref="/"
        user={{ name: "Ирина Ковальчук", email: "irina@example.test" }}
        onLogout={onLogout}
      />,
    );
    expect(screen.getByText("Ирина Ковальчук")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Выйти" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("буквы аватара — первые буквы двух слов имени", () => {
    expect(initials("ирина ковальчук")).toBe("ИК");
    expect(initials("  Администратор ")).toBe("А");
  });
});
