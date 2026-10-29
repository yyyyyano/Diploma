// Раздел «Администрирование» (design/screens/Admin.dc.html, ADM-01…60): заголовок, плашка PRIV-07 и вкладки-ссылки
// (/admin/users, /admin/system — у каждой свой адрес). Вкладки остальных модулей (законы, ставки, ИИ, качество) — их
// задачи. Ссылки, а не Tabs Mantine: у вкладки-маршрута нет панели на странице, а aria-controls без панели — ошибка axe.
import { Link, Outlet } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "../../ui/index.ts";
import classes from "./Admin.module.css";

export function AdminLayout() {
  const { t } = useTranslation("admin");
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className={classes.body}>
        <p className={classes.banner}>
          <ShieldCheck size={18} strokeWidth={1.8} aria-hidden />
          {t("privacy")}
        </p>
        <nav className={classes.tabs} aria-label={t("tabs.label")}>
          <Link to="/admin/users" className={classes.tab} activeProps={{ "aria-current": "page" }}>
            {t("tabs.users")}
          </Link>
          <Link
            to="/admin/ai-requests"
            search={{ period: "day" }}
            className={classes.tab}
            activeProps={{ "aria-current": "page" }}
          >
            {t("tabs.aiRequests")}
          </Link>
          <Link
            to="/admin/ai-providers"
            className={classes.tab}
            activeProps={{ "aria-current": "page" }}
          >
            {t("tabs.aiProviders")}
          </Link>
          <Link to="/admin/system" className={classes.tab} activeProps={{ "aria-current": "page" }}>
            {t("tabs.system")}
          </Link>
        </nav>
        <Outlet />
      </div>
    </>
  );
}
