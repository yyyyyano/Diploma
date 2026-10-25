// Бейдж статуса (DES-03, NFR-20, design/DESIGN.md §1): цвет роли всегда с иконкой — без иконки не компилируется,
// смысл не держится на одном цвете. Внимание — треугольник, риск — «!», успех — галочка (выбор иконки — у страницы).
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx.ts";
import classes from "./StatusBadge.module.css";

export type StatusTone = "ok" | "warn" | "danger" | "law" | "amber" | "neutral" | "brand";

export interface StatusBadgeProps {
  readonly tone: StatusTone;
  readonly icon: LucideIcon;
  readonly children: ReactNode;
}

export function StatusBadge({ tone, icon: Icon, children }: StatusBadgeProps) {
  return (
    <span className={cx(classes.badge, classes[tone])}>
      <Icon size={14} strokeWidth={1.8} aria-hidden />
      {children}
    </span>
  );
}
