// Меню из реестра маршрутов (DES-15, ADR-0014): пункт меню — это staticData.nav файла маршрута. Маршрута нет —
// нет и пункта: разделы ещё не готовых фич скрыты сами собой, а задача фичи добавляет пункт вместе с экраном.
import type { resources } from "@kosht/i18n";
import type { LucideIcon } from "lucide-react";
import type { Role } from "./session.ts";

/** Группы бокового меню по DES-15, в порядке показа: без подписи (Главная, Ассистент), затем подписанные. */
export const NAV_GROUPS = ["main", "money", "law", "profile"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

/** Раздел — ключ подписи `shell:nav.<раздел>`. */
export type NavSection = keyof (typeof resources)["ru"]["shell"]["nav"];

export interface NavEntry {
  readonly group: NavGroup;
  /** Порядок внутри группы (DES-15): меньше — выше. */
  readonly order: number;
  readonly section: NavSection;
  readonly icon: LucideIcon;
  /** Пункт нижней панели телефона (Главная, Операции, Ассистент); остальные — в «Ещё». */
  readonly phoneTab?: boolean;
  /** Пункт только для роли (Администрирование — admin). */
  readonly role?: Role;
}

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    /** Пункт меню раздела. */
    readonly nav?: NavEntry;
    /** Id страницы для контекста ассистента (CHAT-08, PageContext). */
    readonly page?: string;
  }
}

export interface NavItem {
  readonly section: NavSection;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly phoneTab: boolean;
}

export interface NavGroupView {
  readonly group: NavGroup;
  readonly items: readonly NavItem[];
}

/** Маршрут глазами меню: полный путь и staticData (форма значений router.routesById). */
export interface NavRoute {
  readonly fullPath: string;
  readonly options: { readonly staticData?: { readonly nav?: NavEntry } };
}

/** Меню для роли: группы DES-15 по порядку, пустые группы не показываются. */
export function buildNav(routes: readonly NavRoute[], role: Role | undefined): NavGroupView[] {
  const entries = routes.flatMap((route) => {
    const nav = route.options.staticData?.nav;
    if (nav === undefined || (nav.role !== undefined && nav.role !== role)) return [];
    return [{ nav, href: route.fullPath }];
  });
  return NAV_GROUPS.map((group) => ({
    group,
    items: entries
      .filter(({ nav }) => nav.group === group)
      .toSorted((a, b) => a.nav.order - b.nav.order)
      .map(({ nav, href }) => ({
        section: nav.section,
        href,
        icon: nav.icon,
        phoneTab: nav.phoneTab === true,
      })),
  })).filter((view) => view.items.length > 0);
}

/** Пункт подсвечен на своей странице и её вложенных («/operations/123»); «/» — только на главной. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
