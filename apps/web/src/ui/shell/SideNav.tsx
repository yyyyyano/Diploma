// Боковое меню (DES-15, design/screens/Main.dc.html .k-side): логотип, группы разделов, пользователь и «Выйти».
// ≤ 860 px — строка с горизонтальной прокруткой над содержимым; ≤ 760 px (телефон) — только логотип, разделы —
// в нижней панели (BottomNav).
import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cx } from "../cx.ts";
import classes from "./SideNav.module.css";
import { followLink, type NavigateHandler, type ShellNavGroup, type ShellUser } from "./types.ts";

export interface SideNavProps {
  readonly groups: readonly ShellNavGroup[];
  readonly homeHref: string;
  readonly user?: ShellUser;
  readonly onLogout?: () => void;
  readonly onNavigate?: NavigateHandler;
}

/** Буквы аватара: первые буквы двух первых слов имени («Ирина Ковальчук» → «ИК»). */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

export function SideNav({ groups, homeHref, user, onLogout, onNavigate }: SideNavProps) {
  const { t } = useTranslation("shell");
  const brand = t("brand");
  return (
    <aside className={classes.side} aria-label={t("sideLabel")}>
      <a
        className={classes.logo}
        href={homeHref}
        aria-label={t("homeLink")}
        onClick={followLink(onNavigate, homeHref)}
      >
        <span className={classes.mark} aria-hidden>
          {brand.charAt(0)}
        </span>
        <span className={classes.word}>{brand}</span>
      </a>
      {groups.length > 0 && (
        <nav className={classes.nav} aria-label={t("navLabel")}>
          {groups.map((group) => (
            <div key={group.key} className={classes.group}>
              {group.label !== undefined && <div className={classes.label}>{group.label}</div>}
              {group.items.map((item) => (
                <a
                  key={item.key}
                  href={item.href}
                  className={cx(classes.link, item.active && classes.on)}
                  aria-current={item.active ? "page" : undefined}
                  onClick={followLink(onNavigate, item.href)}
                >
                  <item.icon size={20} strokeWidth={1.8} aria-hidden />
                  {item.label}
                </a>
              ))}
            </div>
          ))}
        </nav>
      )}
      {user !== undefined && (
        <div className={classes.user}>
          <span className={classes.avatar} aria-hidden>
            {initials(user.name)}
          </span>
          <div className={classes.who}>
            <div className={classes.name}>{user.name}</div>
            <div className={classes.email}>{user.email}</div>
          </div>
          {onLogout !== undefined && (
            <button
              type="button"
              className={classes.logout}
              aria-label={t("logout")}
              onClick={onLogout}
            >
              <LogOut size={20} strokeWidth={1.8} aria-hidden />
            </button>
          )}
        </div>
      )}
    </aside>
  );
}
