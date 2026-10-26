// Политика обработки персональных данных (PRIV-01; окно «Политика» в design/screens/Register.dc.html — у нас
// отдельная страница /policy, DES-00): цели, перечень данных, где и сколько хранятся, права и кто видит данные —
// простым языком; версия текста — та, что сохраняется с согласием. Ссылка на закон № 99-З — внешняя, на pravo.by.
import { CONSENT_VERSIONS } from "@kosht/i18n";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AuthLayout } from "./AuthLayout.tsx";
import layout from "./AuthLayout.module.css";
import classes from "./PolicyPage.module.css";

/** Закон Республики Беларусь от 07.05.2021 № 99-З на Национальном правовом интернет-портале. */
const LAW_99_URL = "https://pravo.by/document/?guid=12551&p0=H12100099";

const TEXT_SECTIONS = ["data", "purpose", "storage", "retention"] as const;
const RIGHTS = ["know", "export", "withdraw", "delete"] as const;

export function PolicyPage() {
  const { t } = useTranslation(["policy", "auth"]);
  return (
    <AuthLayout>
      <article className={`${layout.card} ${classes.policy}`}>
        <div className={layout.heading}>
          <h1 className={layout.title}>{t("policy:title")}</h1>
          <p className={layout.subtitle}>{t("policy:intro")}</p>
          <p className={classes.version}>
            {t("policy:version", {
              date: CONSENT_VERSIONS.personalData.split("-").reverse().join("."),
            })}
          </p>
        </div>
        {TEXT_SECTIONS.map((key) => (
          <section key={key} className={classes.section}>
            <h2>{t(`policy:sections.${key}.title`)}</h2>
            <p>{t(`policy:sections.${key}.text`)}</p>
          </section>
        ))}
        <section className={classes.section}>
          <h2>{t("policy:sections.rights.title")}</h2>
          <ul>
            {RIGHTS.map((key) => (
              <li key={key}>{t(`policy:sections.rights.items.${key}`)}</li>
            ))}
          </ul>
        </section>
        <section className={classes.section}>
          <h2>{t("policy:sections.access.title")}</h2>
          <p>{t("policy:sections.access.text")}</p>
        </section>
        <a className={classes.law} href={LAW_99_URL} target="_blank" rel="noopener noreferrer">
          {t("policy:lawLink")}
          <ExternalLink size={15} strokeWidth={1.8} aria-hidden />
        </a>
      </article>
      <nav className={layout.footer} aria-label={t("auth:footer.label")}>
        <Link to="/login">{t("auth:footer.toLogin")}</Link>
      </nav>
    </AuthLayout>
  );
}
