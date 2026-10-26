// Каркас страниц гостя (design/screens/Login.dc.html, Register.dc.html): панель бренда слева (на телефоне — сверху
// и короче) и колонка формы. Вход, регистрация, подтверждение адреса и политика — внутри колонки.
import { FileText, Landmark, Scale, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Logo } from "../../ui/index.ts";
import classes from "./AuthLayout.module.css";

const POINTS = [
  { key: "receipts", icon: FileText },
  { key: "deductions", icon: Landmark },
  { key: "laws", icon: Scale },
] as const;

export function AuthLayout({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation("auth");
  return (
    <div className={classes.wrap}>
      <aside className={classes.brand}>
        <Logo on="dark" />
        <div className={classes.pitch}>
          <p className={classes.pitchTitle}>{t("brand.title")}</p>
          <p className={classes.pitchText}>{t("brand.text")}</p>
        </div>
        <ul className={classes.points}>
          {POINTS.map(({ key, icon: Icon }) => (
            <li key={key}>
              <span className={classes.pointIcon}>
                <Icon size={20} strokeWidth={1.8} aria-hidden />
              </span>
              <span>
                <span className={classes.pointTitle}>{t(`brand.points.${key}.title`)}</span>
                <span className={classes.pointText}>{t(`brand.points.${key}.text`)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className={classes.privacy}>
          <ShieldCheck size={16} strokeWidth={1.8} aria-hidden />
          {t("brand.privacy")}
        </p>
      </aside>
      <main className={classes.side}>{children}</main>
    </div>
  );
}
