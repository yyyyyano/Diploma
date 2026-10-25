// Уведомление «Записал… [Отменить]» (P5, design/DESIGN.md §4 .toast): тёмное снизу по центру, 5 с; <output> —
// живая область для экранного диктора. Пока на «Отменить» указатель или фокус, время не идёт (WCAG 2.2.1): успеть
// нажать можно и с клавиатуры.
import { Portal } from "@mantine/core";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import classes from "./UndoToast.module.css";

export interface UndoToastProps {
  readonly opened: boolean;
  readonly message: ReactNode;
  readonly onUndo: () => void;
  /** Время вышло или действие отменено — страница прячет уведомление. */
  readonly onClose: () => void;
  readonly durationMs?: number;
}

export const UNDO_TOAST_MS = 5000;

export function UndoToast({
  opened,
  message,
  onUndo,
  onClose,
  durationMs = UNDO_TOAST_MS,
}: UndoToastProps) {
  const { t } = useTranslation("ui");
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (!opened || paused) return undefined;
    const timer = setTimeout(onClose, durationMs);
    return () => clearTimeout(timer);
  }, [opened, paused, durationMs, onClose]);

  if (!opened) return null;
  return (
    <Portal>
      <output className={classes.toast}>
        <span>{message}</span>
        <button
          type="button"
          className={classes.undo}
          onPointerEnter={() => setPaused(true)}
          onPointerLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          onClick={() => {
            onUndo();
            onClose();
          }}
        >
          {t("undo.action")}
        </button>
      </output>
    </Portal>
  );
}
