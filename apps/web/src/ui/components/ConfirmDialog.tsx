// Подтверждение (P5, design/DESIGN.md §5 .modal): только для удаления и массовых изменений — с перечнем того, что
// изменится, и кнопкой-глаголом («Да, перенести 13»), а не «ОК». Одиночное действие подтверждения не просит.
import { Button, Modal } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import classes from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  readonly opened: boolean;
  readonly title: string;
  /** Что изменится — перечень. */
  readonly children: ReactNode;
  /** Кнопка-глагол: «Да, удалить 3». */
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  /** danger — необратимое (удаление): кнопка цвета риска. */
  readonly tone?: "primary" | "danger";
  /** Действие выполняется: кнопка ждёт, повторное нажатие не уходит. */
  readonly pending?: boolean;
}

export function ConfirmDialog({
  opened,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
  tone = "primary",
  pending = false,
}: ConfirmDialogProps) {
  const { t } = useTranslation("ui");
  return (
    <Modal
      opened={opened}
      onClose={onCancel}
      title={title}
      centered
      size={440}
      radius="lg"
      closeButtonProps={{ "aria-label": t("sheet.close") }}
      classNames={{ overlay: classes.overlay, content: classes.content, title: classes.title }}
    >
      <div className={classes.body}>{children}</div>
      <div className={classes.actions}>
        <Button variant="default" onClick={onCancel} disabled={pending}>
          {t("confirm.cancel")}
        </Button>
        <Button
          color={tone === "danger" ? "var(--danger)" : "brand"}
          onClick={onConfirm}
          loading={pending}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
