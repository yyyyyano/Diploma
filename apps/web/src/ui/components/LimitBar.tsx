// Полоса лимита (BUD-02, DES-14, design/screens/Main.dc.html .lim, Budget.dc.html): расход категории к месячному
// пределу. Цвет и значок — по проценту, а не только цветом (NFR-20): до 80 % — --brand; 80–99 % — --warn-bar и
// треугольник; от 100 % — --danger и «!». Процент и подпись приходят готовыми с сервера (P1): компонент ничего не
// считает, только выбирает вид и ограничивает ширину заливки 100 %.
import { AlertCircle, AlertTriangle } from "lucide-react";
import { cx } from "../cx.ts";
import classes from "./LimitBar.module.css";

export type LimitLevel = "ok" | "warn" | "over";

/** Порог «внимание» — 80 % лимита (BUD-03); от 100 % — превышение. */
export function limitLevel(percent: number): LimitLevel {
  if (percent >= 100) return "over";
  return percent >= 80 ? "warn" : "ok";
}

export interface LimitBarProps {
  /** Процент лимита, целый, с сервера; может быть больше 100. */
  readonly percent: number;
  /** Название лимита — подпись полосы для экранного диктора («Кафе, рестораны и доставка»). */
  readonly label: string;
  /** Строка статуса под полосой: «84% · осталось 32,00 на 10 дней». */
  readonly status: string;
  /** Отметка порога 80 % на полосе (на главной её нет, на экране «Лимиты и цели» — есть). */
  readonly marker?: string;
}

export function LimitBar({ percent, label, status, marker }: LimitBarProps) {
  const level = limitLevel(percent);
  const filled = Math.min(100, Math.max(0, percent));
  return (
    <div className={classes.limit} data-level={level}>
      <div className={classes.track}>
        <progress
          className={cx(classes.bar, classes[level])}
          aria-label={label}
          aria-valuetext={status}
          value={filled}
          max={100}
        />
        {marker !== undefined && <span className={classes.tick} aria-hidden />}
      </div>
      {marker !== undefined && (
        <span className={classes.markerLabel} aria-hidden>
          {marker}
        </span>
      )}
      <p className={cx(classes.status, classes[`text-${level}`])}>
        {level === "warn" && <AlertTriangle size={16} strokeWidth={1.8} aria-hidden />}
        {level === "over" && <AlertCircle size={16} strokeWidth={1.8} aria-hidden />}
        <span>{status}</span>
      </p>
    </div>
  );
}
