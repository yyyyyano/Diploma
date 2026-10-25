// Знак и слово «Кошт» (design/kit.css .k-logo, .k-mark, .k-word): шапка входа, первого запуска и панели бренда.
// on="dark" — на тёмной хвое (панель бренда входа), on="light" — на белой шапке. Буква знака — первая буква
// названия из словаря: знак декоративный, название читается словом.
import { useTranslation } from "react-i18next";
import { cx } from "../cx.ts";
import classes from "./Logo.module.css";

export interface LogoProps {
  readonly on?: "light" | "dark";
}

export function Logo({ on = "light" }: LogoProps) {
  const { t } = useTranslation("shell");
  const brand = t("brand");
  return (
    <span className={cx(classes.logo, on === "dark" && classes.dark)}>
      <span className={classes.mark} aria-hidden>
        {brand.charAt(0)}
      </span>
      <span className={classes.word}>{brand}</span>
    </span>
  );
}
