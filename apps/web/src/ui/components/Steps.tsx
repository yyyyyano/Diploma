// Шаги проверки (RCPT-02, RCPT-06, design/screens/Documents.dc.html «Читаю чек → Проверяю арифметику → …»): список этапов
// с состоянием — сделан, идёт, ждёт. Состояние не держится на цвете: у сделанного галочка, у идущего «точка» с анимацией
// и подписью для чтения с экрана, у ожидающего пустой кружок. Анимация отключается при `prefers-reduced-motion`.
import { Check, Circle, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "../cx.ts";
import classes from "./Steps.module.css";

export type StepState = "done" | "active" | "pending";

export interface StepItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly state: StepState;
}

export interface StepsProps {
  readonly steps: readonly StepItem[];
  /** Подпись списка для чтения с экрана («Этапы проверки чека»). */
  readonly label: string;
  /** Подписи состояний для чтения с экрана: «сделано», «идёт», «ждёт». */
  readonly stateLabels: Readonly<Record<StepState, string>>;
}

export function Steps({ steps, label, stateLabels }: StepsProps) {
  return (
    <ol className={classes.steps} aria-label={label}>
      {steps.map((step) => (
        <li key={step.id} className={cx(classes.step, classes[step.state])} data-state={step.state}>
          <span className={classes.mark} aria-hidden>
            {step.state === "done" && <Check size={14} strokeWidth={2.2} />}
            {step.state === "active" && (
              <LoaderCircle size={14} strokeWidth={2.2} className={classes.spin} />
            )}
            {step.state === "pending" && <Circle size={14} strokeWidth={1.8} />}
          </span>
          <span>{step.label}</span>{" "}
          <span className={classes.srOnly}>{stateLabels[step.state]}</span>
        </li>
      ))}
    </ol>
  );
}
