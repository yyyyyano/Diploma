// Выбор новой категории для выбранных операций (TXN-04): окно с выбором категории (встроенные и свои нужного вида,
// «Новая категория») и «Продолжить» — дальше страница показывает вопрос «Да/Нет» с перечнем и числом.
import type { CategoryKind, CategoryRef } from "@kosht/contract";
import { Button, Modal } from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryPicker } from "../../entities/category/index.ts";
import classes from "./BulkCategoryDialog.module.css";

export interface BulkCategoryDialogProps {
  readonly count: number;
  readonly kind: CategoryKind;
  readonly pending: boolean;
  readonly onNext: (category: CategoryRef) => void;
  readonly onClose: () => void;
}

export function BulkCategoryDialog({
  count,
  kind,
  pending,
  onNext,
  onClose,
}: BulkCategoryDialogProps) {
  const { t } = useTranslation("operations");
  const { t: tUi } = useTranslation("ui");
  const [category, setCategory] = useState<CategoryRef | null>(null);
  return (
    <Modal
      opened
      onClose={onClose}
      title={t("bulk.categoryTitle")}
      closeButtonProps={{ "aria-label": tUi("sheet.close") }}
    >
      <p className={classes.hint}>{t("bulk.categoryHint", { count })}</p>
      <CategoryPicker kind={kind} value={category} onChange={setCategory} />
      <div className={classes.actions}>
        <Button variant="subtle" onClick={onClose}>
          {t("form.cancel")}
        </Button>
        <Button
          disabled={category === null}
          loading={pending}
          onClick={() => category !== null && onNext(category)}
        >
          {t("bulk.categoryNext")}
        </Button>
      </div>
    </Modal>
  );
}
