// Карточка показателя (DES-13, design/screens/Main.dc.html .kpi): подпись с ⓘ, крупное число, пояснение.
// Свободный остаток — карточка --brand-soft (free), ключевой показатель выгоды — янтарная (benefit).
import type { ReactNode } from "react";
import { cx } from "../cx.ts";
import classes from "./StatCard.module.css";

export interface StatCardProps {
  readonly title: string;
  /** Значение — обычно <Money size="kpi">. */
  readonly value: ReactNode;
  readonly hint?: ReactNode;
  /** Кнопка «Откуда эта цифра?» (<WhyButton>). */
  readonly why?: ReactNode;
  readonly tone?: "default" | "free" | "benefit";
}

export function StatCard({ title, value, hint, why, tone = "default" }: StatCardProps) {
  return (
    <div className={cx(classes.card, tone !== "default" && classes[tone])}>
      <div className={classes.head}>
        <span>{title}</span>
        {why}
      </div>
      <div className={classes.value}>{value}</div>
      {hint !== undefined && <div className={classes.hint}>{hint}</div>}
    </div>
  );
}
