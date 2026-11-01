// Плашка «Локальный режим» (PRIV-02, design: .as-local): пока нет облачного согласия, ответы даёт только локальная
// модель — медленнее, но данные не покидают компьютер; ссылка ведёт к настройке согласия.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import classes from "./LocalModeBanner.module.css";

/** Облачное согласие дано (по действующему тексту): `undefined` — ещё не известно, плашку не показываем. */
export function useCloudGranted(): boolean | undefined {
  return useQuery(orpc.privacy.state.queryOptions()).data?.cloud.granted;
}

export function LocalModeBanner() {
  const { t } = useTranslation("assistant");
  if (useCloudGranted() !== false) return null;
  return (
    <div className={classes.banner} role="note">
      <Cpu size={18} strokeWidth={1.8} aria-hidden />
      <span>{t("local.text")}</span>
      <Link to="/settings" search={{ tab: "privacy" }} className={classes.link}>
        {t("local.link")}
      </Link>
    </div>
  );
}
