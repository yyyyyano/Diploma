// Статус чека (RCPT-07, DES-03, NFR-20): «Сумма сходится 100%» — зелёный с галочкой, «Требует проверки» — охристый с
// треугольником, «Ожидает выписки» — нейтральный с часами; цвет всегда вместе с иконкой и текстом.
import type { ReceiptSummary } from "@kosht/contract";
import {
  CircleCheck,
  Clock,
  LoaderCircle,
  ShieldCheck,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "../../ui/index.ts";

export function ReceiptStatusBadge({
  receipt,
}: {
  readonly receipt: Pick<ReceiptSummary, "status" | "confirmed">;
}) {
  const { t } = useTranslation("documents");
  switch (receipt.status) {
    case "ok":
      return (
        <StatusBadge tone="ok" icon={CircleCheck}>
          {t("receipts.status.ok")}
        </StatusBadge>
      );
    case "needs-review":
      return receipt.confirmed ? (
        <StatusBadge tone="neutral" icon={ShieldCheck}>
          {t("receipts.status.confirmed")}
        </StatusBadge>
      ) : (
        <StatusBadge tone="warn" icon={TriangleAlert}>
          {t("receipts.status.needs-review")}
        </StatusBadge>
      );
    case "failed":
      return (
        <StatusBadge tone="danger" icon={XCircle}>
          {t("receipts.status.failed")}
        </StatusBadge>
      );
    default:
      return (
        <StatusBadge tone="neutral" icon={LoaderCircle}>
          {t("receipts.status.processing")}
        </StatusBadge>
      );
  }
}

export function PendingBadge() {
  const { t } = useTranslation("documents");
  return (
    <StatusBadge tone="neutral" icon={Clock}>
      {t("receipts.status.pending")}
    </StatusBadge>
  );
}
