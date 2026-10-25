// Каркас раздела пользователя (DES-15, ARCHITECTURE §10.1): меню — из реестра маршрутов (staticData.nav) под роль
// текущей сессии, поток живых обновлений, выход с очисткой кэша. Колокольчик, «Сканировать чек» и плавающая
// кнопка ассистента появятся с модулями уведомлений, чеков и чата (T-015, T-028, T-043).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useEventStream } from "../../lib/events.ts";
import { buildNav, isNavActive, splitPhoneNav, type NavItem } from "../../lib/nav.ts";
import { signOut, type SessionSource } from "../../lib/session.ts";
import {
  AppFrame,
  BottomNav,
  SideNav,
  type NavigateHandler,
  type ShellNavItem,
} from "../../ui/shell/index.ts";

/** Ключ кэша пользователя сессии: выход чистит кэш целиком — и его тоже. */
export const SESSION_QUERY_KEY = ["session", "current"] as const;

export function useSessionUser(session: SessionSource) {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    // TanStack Query не хранит undefined: гость — null.
    queryFn: async () => (await session.current()) ?? null,
  });
}

export function AppShell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = router.options.context;
  const { t } = useTranslation("shell");
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: user } = useSessionUser(session);
  useEventStream();

  const groups = buildNav(Object.values(router.routesById), user?.role);
  const view = (item: NavItem): ShellNavItem => ({
    key: item.section,
    label: t(`nav.${item.section}`),
    href: item.href,
    icon: item.icon,
    active: isNavActive(item.href, pathname),
  });
  const phone = splitPhoneNav(groups);
  const onNavigate: NavigateHandler = (href, event) => {
    event.preventDefault();
    router.history.push(href);
  };
  const onLogout = () => {
    void signOut(session, queryClient).finally(() => {
      void router.invalidate();
    });
  };

  return (
    <AppFrame
      side={
        <SideNav
          homeHref="/"
          groups={groups.map((group) => ({
            key: group.group,
            ...(group.group === "main" ? {} : { label: t(`groups.${group.group}`) }),
            items: group.items.map(view),
          }))}
          {...(user ? { user: { name: user.name, email: user.email }, onLogout } : {})}
          onNavigate={onNavigate}
        />
      }
      bottom={
        phone.tabs.length + phone.more.length > 0 && (
          <BottomNav
            tabs={phone.tabs.map(view)}
            more={phone.more.map(view)}
            onNavigate={onNavigate}
          />
        )
      }
    >
      <Outlet />
    </AppFrame>
  );
}
