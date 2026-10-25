// Загрузка (DES-16, design/DESIGN.md §5 .sk): скелетон повторяет форму будущего содержимого — карточку показателя,
// строки списка, абзац. Для экранного диктора — одна живая область «Загрузка…», полосы скрыты.
import { VisuallyHidden } from "@mantine/core";
import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import classes from "./Skeletons.module.css";

export interface SkeletonProps {
  readonly width?: CSSProperties["width"];
  readonly height?: CSSProperties["height"];
}

/** Одна полоса; ширина и высота — по форме содержимого. */
export function Skeleton({ width = "100%", height = 14 }: SkeletonProps) {
  return <span className={classes.sk} style={{ width, height }} aria-hidden />;
}

/** Обёртка загрузки: aria-busy и текст «Загрузка…» для экранного диктора. */
export function Loading({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation("ui");
  return (
    <output aria-busy="true" className={classes.stack}>
      <VisuallyHidden>{t("loading")}</VisuallyHidden>
      {children}
    </output>
  );
}

/** Карточка показателя: подпись, крупное число, пояснение. */
export function SkeletonCard() {
  return (
    <Loading>
      <div className={classes.card}>
        <Skeleton width="45%" height={14} />
        <Skeleton width="70%" height={30} />
        <Skeleton width="55%" height={12} />
      </div>
    </Loading>
  );
}

/** Строки списка или таблицы: значок, две строки текста, сумма справа. */
export function SkeletonList({ rows = 5 }: { readonly rows?: number }) {
  return (
    <Loading>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className={classes.row}>
          <Skeleton width={34} height={34} />
          <div className={classes.lines}>
            <Skeleton width="60%" height={14} />
            <Skeleton width="35%" height={12} />
          </div>
          <Skeleton width={72} height={14} />
        </div>
      ))}
    </Loading>
  );
}

/** Абзац текста: последняя строка короче. */
export function SkeletonText({ lines = 3 }: { readonly lines?: number }) {
  return (
    <Loading>
      {Array.from({ length: lines }, (_, line) => (
        <Skeleton key={line} width={line === lines - 1 ? "60%" : "100%"} />
      ))}
    </Loading>
  );
}
