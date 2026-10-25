// Нижняя панель телефона (DES-15, design/screens/MobileHome.dc.html .ph-nav): Главная · Операции · круглая кнопка
// «Чек» · Ассистент · Ещё. Пункты приходят из меню (phoneTab), кнопку «Чек» встраивает задача чеков (center),
// остальные разделы — в шторке «Ещё». Видна только на телефоне (≤ 760 px); embedded — для витрины.
import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Sheet } from "../components/Sheet.tsx";
import { cx } from "../cx.ts";
import classes from "./BottomNav.module.css";
import { followLink, type NavigateHandler, type ShellNavItem } from "./types.ts";

export interface BottomNavProps {
  readonly tabs: readonly ShellNavItem[];
  /** Разделы шторки «Ещё»; пусто — кнопки «Ещё» нет. */
  readonly more: readonly ShellNavItem[];
  /** Круглая кнопка посередине («Чек»). */
  readonly center?: ReactNode;
  readonly onNavigate?: NavigateHandler;
  /** Показ на месте, а не прибитой к низу экрана (витрина компонентов). */
  readonly embedded?: boolean;
}

export function BottomNav({ tabs, more, center, onNavigate, embedded = false }: BottomNavProps) {
  const { t } = useTranslation("shell");
  const [moreOpen, setMoreOpen] = useState(false);
  const half = Math.ceil(tabs.length / 2);
  const link = (item: ShellNavItem) => (
    <a
      key={item.key}
      href={item.href}
      className={cx(classes.tab, item.active && classes.on)}
      aria-current={item.active ? "page" : undefined}
      onClick={followLink(onNavigate, item.href)}
    >
      <item.icon size={20} strokeWidth={1.8} aria-hidden />
      {item.label}
    </a>
  );
  return (
    <nav className={cx(classes.bar, embedded && classes.embedded)} aria-label={t("bottomLabel")}>
      {tabs.slice(0, half).map(link)}
      {center}
      {tabs.slice(half).map(link)}
      {more.length > 0 && (
        <>
          <button
            type="button"
            className={classes.tab}
            aria-label={t("moreLabel")}
            aria-haspopup="dialog"
            onClick={() => setMoreOpen(true)}
          >
            <Menu size={20} strokeWidth={1.8} aria-hidden />
            {t("more")}
          </button>
          <Sheet
            opened={moreOpen}
            onClose={() => setMoreOpen(false)}
            title={t("moreTitle")}
            position="bottom"
          >
            <div className={classes.moreList}>
              {more.map((item) => (
                <a
                  key={item.key}
                  href={item.href}
                  className={classes.moreLink}
                  aria-current={item.active ? "page" : undefined}
                  onClick={(event) => {
                    followLink(onNavigate, item.href)(event);
                    setMoreOpen(false);
                  }}
                >
                  <item.icon size={20} strokeWidth={1.8} aria-hidden />
                  {item.label}
                </a>
              ))}
            </div>
          </Sheet>
        </>
      )}
    </nav>
  );
}
