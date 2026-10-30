// Рамка гостя (design/screens/Laws.dc.html, состояние guest): без бокового меню — знак «Кошт», метка раздела, «Войти» и
// «Регистрация». Вошедший видит тот же экран внутри обычного каркаса (маршрут выбирает рамку).
import { Link } from "@tanstack/react-router";
import { Scale } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "../../ui/index.ts";
import classes from "./GuestFrame.module.css";

export function GuestFrame({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation("laws");
  return (
    <div className={classes.frame}>
      <header className={classes.bar}>
        <div className={classes.brand}>
          <Link to="/" aria-label={t("guest.badge")}>
            <Logo on="light" />
          </Link>
          <span className={classes.tag}>
            <Scale size={14} strokeWidth={1.8} aria-hidden />
            {t("guest.badge")}
          </span>
        </div>
        <nav className={classes.actions}>
          <Link to="/login" className={classes.secondary}>
            {t("guest.login")}
          </Link>
          <Link to="/register" className={classes.primary}>
            {t("guest.register")}
          </Link>
        </nav>
      </header>
      <main className={classes.main}>{children}</main>
    </div>
  );
}
