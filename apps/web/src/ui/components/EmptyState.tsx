// Пустое состояние и ошибка экрана (DES-16, design/DESIGN.md §5 .empty): иконка, что здесь будет (или что
// случилось), и 1–3 первых шага (или что сделать) — кнопками в actions.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx.ts";
import classes from "./EmptyState.module.css";

export interface EmptyStateProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: ReactNode;
  readonly actions?: ReactNode;
  /** Уровень заголовка по месту на странице: 1 — состояние всей страницы, 2 — блока. */
  readonly headingLevel?: 1 | 2 | 3;
  /** error — ошибка: иконка цвета риска (с «!» на самой иконке), остальное — как у пустого. */
  readonly tone?: "empty" | "error";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  actions,
  headingLevel = 2,
  tone = "empty",
}: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={cx(classes.empty, tone === "error" && classes.error)}>
      <span className={classes.icon}>
        <Icon size={32} strokeWidth={1.8} aria-hidden />
      </span>
      <Heading className={classes.title}>{title}</Heading>
      <p className={classes.description}>{description}</p>
      {actions !== undefined && <div className={classes.actions}>{actions}</div>}
    </div>
  );
}
