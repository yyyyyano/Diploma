// Панель действий с выбранными (design/screens/Operations.dc.html .ops-bulk, TXN-04): «Выбрано: N», «Сменить категорию»,
// «Пометить переводом», «Удалить», «Снять выделение». Каждое действие — вопрос «Да/Нет» с перечнем (страница), здесь
// только кнопки.
import { Button } from "@mantine/core";
import { ArrowLeftRight, Pencil, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import classes from "./BulkBar.module.css";

export interface BulkBarProps {
  readonly count: number;
  readonly onChangeCategory: () => void;
  readonly onMarkTransfer: () => void;
  readonly onDelete: () => void;
  readonly onClear: () => void;
}

export function BulkBar({
  count,
  onChangeCategory,
  onMarkTransfer,
  onDelete,
  onClear,
}: BulkBarProps) {
  const { t } = useTranslation("operations");
  return (
    <section className={classes.bar} aria-label={t("bulk.label")}>
      <strong className={classes.count}>{t("bulk.selected", { count })}</strong>
      <Button
        variant="subtle"
        size="sm"
        className={classes.action}
        leftSection={<Pencil size={16} aria-hidden />}
        onClick={onChangeCategory}
      >
        {t("bulk.changeCategory")}
      </Button>
      <Button
        variant="subtle"
        size="sm"
        className={classes.action}
        leftSection={<ArrowLeftRight size={16} aria-hidden />}
        onClick={onMarkTransfer}
      >
        {t("bulk.markTransfer")}
      </Button>
      <Button
        variant="subtle"
        size="sm"
        className={classes.action}
        leftSection={<Trash2 size={16} aria-hidden />}
        onClick={onDelete}
      >
        {t("bulk.delete")}
      </Button>
      <Button variant="subtle" size="sm" className={classes.clear} onClick={onClear}>
        {t("bulk.clear")}
      </Button>
    </section>
  );
}
