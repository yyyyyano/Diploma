// Вложение сообщения (`data-attachment`, CHAT-03, SEC-03): файл принят конвейером раздела «Чеки и документы» (чек —
// `receipts`, выписка — `statements`), здесь — его карточка с живым состоянием. Состояние берётся у `receipts.get` /
// `statements.get` — чужой или удалённый id даёт NOT_FOUND и карточку «Файл не найден», а не чужие данные. Сигналы
// `receipt` и `statement-import` обновляют карточку, пока файл читается.
import { ChatAttachment } from "@kosht/contract";
import { Skeleton } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileSpreadsheet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ReceiptPreview } from "../../../entities/receipt/index.ts";
import { orpc } from "../../../lib/api.ts";
import classes from "./cards.module.css";
import { Unavailable } from "./Unavailable.tsx";

export function AttachmentCard({ data }: { readonly data: unknown }) {
  const parsed = ChatAttachment.safeParse(data);
  if (!parsed.success) return <Unavailable />;
  return parsed.data.kind === "receipt" ? (
    <ReceiptAttachment id={parsed.data.id} />
  ) : (
    <StatementAttachment id={parsed.data.id} />
  );
}

function NotFound() {
  const { t } = useTranslation("assistant");
  return <p className={classes.line}>{t("cards.attachment.notFound")}</p>;
}

function ReceiptAttachment({ id }: { readonly id: string }) {
  const { t } = useTranslation("assistant");
  const receipt = useQuery(orpc.receipts.get.queryOptions({ input: { id } }));
  if (receipt.isPending) return <Skeleton height={120} radius="md" />;
  if (receipt.isError) return <NotFound />;
  return (
    <ReceiptPreview card={receipt.data}>
      <Link to="/documents" search={{ open: id }} className={classes.linkButton}>
        {t("cards.attachment.openReceipt")}
      </Link>
    </ReceiptPreview>
  );
}

function StatementAttachment({ id }: { readonly id: string }) {
  const { t } = useTranslation(["assistant", "documents"]);
  const detail = useQuery(orpc.statements.get.queryOptions({ input: { id } }));
  if (detail.isPending) return <Skeleton height={96} radius="md" />;
  if (detail.isError) return <NotFound />;
  const { summary } = detail.data;
  return (
    <article className={classes.card} aria-label={t("assistant:cards.attachment.statement")}>
      <p className={classes.line}>
        <FileSpreadsheet size={18} strokeWidth={1.8} aria-hidden />
        <span className={classes.title}>
          {summary.bank ?? t("assistant:cards.attachment.statement")}
        </span>
      </p>
      <p className={classes.line}>
        {t("assistant:cards.attachment.statementStatus", {
          status: t(`documents:status.${summary.status}`),
        })}
      </p>
      {summary.found > 0 && (
        <p className={classes.line}>
          {t("assistant:cards.attachment.statementFound", {
            found: summary.found,
            fresh: summary.newCount,
          })}
        </p>
      )}
      <div className={classes.buttons}>
        <Link to="/documents" search={{ import: id }} className={classes.linkButton}>
          {t("assistant:cards.attachment.openStatement")}
        </Link>
      </div>
    </article>
  );
}
