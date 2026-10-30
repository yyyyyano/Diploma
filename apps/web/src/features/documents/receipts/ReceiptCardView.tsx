// Карточка чека (design/screens/Documents.dc.html: scan-checking, scan-result, receipt-panel; RCPT-02, RCPT-06…08, RCPT-11,
// RCPT-12): этапы проверки с анимацией по строкам («Читаю чек → Проверяю арифметику → Перепроверка строки 2»), результат
// с бейджем статуса, позиции, спорные строки, «Верно / Изменить / Отменить», фото, «Проверить на сайте МНС» (УИ и день
// копируются, запросов к МНС нет), дубль («Этот чек уже загружен 12.10»). Статус, суммы и остаток — с сервера (P1).
import { ERROR_CODES, type ErrorCode, type ReceiptCard } from "@kosht/contract";
import { formatDate, formatMoney, formatTime } from "@kosht/i18n";
import { Button } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Image as ImageIcon, Pencil, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CategoryBadge } from "../../../entities/category/index.ts";
import {
  formatQuantity,
  PendingBadge,
  ReceiptStatusBadge,
} from "../../../entities/receipt/index.ts";
import { orpc } from "../../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../../lib/errors.ts";
import { progressQueryKey, type Progress } from "../../../lib/events.ts";
import {
  ConfirmDialog,
  EmptyState,
  Money,
  SkeletonCard,
  Steps,
  type StepItem,
} from "../../../ui/index.ts";
import { ReceiptEditor } from "./ReceiptEditor.tsx";
import classes from "./ReceiptsSection.module.css";

/** Код ошибки чека из записи (`error_code`) для текста человеку; неизвестный — «что-то пошло не так». */
function errorCodeFrom(code: string | null): ErrorCode {
  return ERROR_CODES.find((known) => known === code) ?? "INTERNAL";
}

/** Сервис МНС «Проверка чека»: открывается по ссылке, автоматически не запрашивается (RCPT-12: reCAPTCHA). */
const MNS_URL = "https://ch.info-center.by/";

export function ReceiptCardView({
  id,
  onOpen,
  onClose,
}: {
  readonly id: string;
  readonly onOpen: (id: string | null) => void;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation(["documents", "errors"]);
  const queryClient = useQueryClient();
  const card = useQuery(orpc.receipts.get.queryOptions({ input: { id } }));
  const progress = useQuery<Progress>({
    queryKey: progressQueryKey("receipt", id),
    queryFn: () => ({}),
    enabled: false,
  });
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: orpc.receipts.key() });
    await queryClient.invalidateQueries({ queryKey: orpc.transactions.key() });
    await queryClient.invalidateQueries({ queryKey: orpc.accounts.key() });
  };
  const failed = (error: unknown) =>
    setNotice(
      t("documents:receipts.card.error", {
        reason: t(`errors:${errorCodeOf(error)}`, errorParamsOf(error)),
      }),
    );
  const confirm = useMutation(
    orpc.receipts.confirm.mutationOptions({ onSuccess: refresh, onError: failed }),
  );
  const cancel = useMutation(
    orpc.receipts.cancel.mutationOptions({
      onSuccess: async () => {
        setAsking(false);
        onClose();
        await refresh();
      },
      onError: failed,
    }),
  );

  if (card.isPending) return <SkeletonCard />;
  if (card.isError) {
    return (
      <EmptyState
        tone="error"
        icon={AlertTriangle}
        title={t("documents:receipts.card.loadError")}
        description={t("documents:error.text")}
        actions={<Button onClick={() => void card.refetch()}>{t("documents:error.retry")}</Button>}
      />
    );
  }
  const data = card.data;
  const { receipt } = data;

  if (receipt.status === "processing") {
    return <Checking receipt={data} percent={progress.data?.percent} />;
  }

  return (
    <section className={classes.card} aria-labelledby="receipt-title">
      <div className={classes.cardHead}>
        <div>
          <h3 id="receipt-title" className={classes.cardTitle}>
            {receipt.storeName ?? t("documents:receipts.list.store")}
          </h3>
          <p className={classes.meta}>{metaLine(data)}</p>
        </div>
        <div className={classes.actions}>
          <ReceiptStatusBadge receipt={receipt} />
          {data.operation?.pending === true && <PendingBadge />}
        </div>
      </div>

      {receipt.status === "failed" ? (
        <Failed card={data} onOpen={onOpen} />
      ) : (
        <div className={classes.cols}>
          <div className={classes.photo}>
            <img
              className={classes.photoImg}
              src={`/api/files/${data.fileId}`}
              alt={t("documents:receipts.card.photoAlt")}
            />
            <Button
              component="a"
              href={`/api/files/${data.fileId}`}
              target="_blank"
              rel="noopener noreferrer"
              variant="default"
              size="xs"
              leftSection={<ImageIcon size={16} aria-hidden />}
            >
              {t("documents:receipts.card.photo")}
            </Button>
            <Mns card={data} />
          </div>
          <div className={classes.photo}>
            <Verdict card={data} onFix={() => setEditing(true)} />
            <ol
              className={classes.lines}
              aria-label={t("documents:receipts.card.items", { count: data.items.length })}
            >
              {data.items.map((item) => (
                <li key={item.position} className={classes.line} data-disputed={item.disputed}>
                  <span className={classes.lineNo}>{item.position}</span>
                  <span className={classes.lineName}>
                    <span>{item.name}</span>
                    {item.category !== null && <CategoryBadge category={item.category} />}
                    {item.disputed && (
                      <span className={classes.lineNote}>
                        {t("documents:receipts.card.lineDisputed")}
                      </span>
                    )}
                    {!item.disputed &&
                      data.attempts.some((a) => a.changedLines.includes(item.position)) && (
                        <span className={classes.lineNote}>
                          {t("documents:receipts.card.recheckedLine")}
                        </span>
                      )}
                  </span>
                  <span className={classes.lineSum}>
                    {item.lineTotal !== null && <Money value={item.lineTotal} tabular />}
                    {item.quantityMilli !== null && item.unitPrice !== null && (
                      <span className={classes.meta}>
                        {t("documents:receipts.card.quantity", {
                          quantity: formatQuantity(item.quantityMilli),
                          unit: item.unit ?? "",
                          price: formatMoney(item.unitPrice),
                        })}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {data.operation !== null && <OperationNote card={data} />}
          </div>
        </div>
      )}

      {notice !== null && (
        <p className={classes.error} role="alert">
          {notice}
        </p>
      )}
      <div className={classes.actions}>
        {receipt.status !== "failed" && (
          <>
            <Button
              loading={confirm.isPending}
              disabled={receipt.confirmed}
              onClick={() => confirm.mutate({ id })}
            >
              {t("documents:receipts.card.verify")}
            </Button>
            <Button
              variant="default"
              leftSection={<Pencil size={16} aria-hidden />}
              onClick={() => setEditing(true)}
            >
              {t("documents:receipts.card.edit")}
            </Button>
          </>
        )}
        <Button
          variant="subtle"
          leftSection={<Undo2 size={16} aria-hidden />}
          onClick={() => setAsking(true)}
        >
          {t("documents:receipts.card.cancel")}
        </Button>
      </div>

      {editing && (
        <ReceiptEditor
          card={data}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await refresh();
          }}
        />
      )}
      <ConfirmDialog
        opened={asking}
        tone="danger"
        title={t("documents:receipts.card.cancelTitle")}
        confirmLabel={t("documents:receipts.card.cancelConfirm")}
        pending={cancel.isPending}
        onConfirm={() => cancel.mutate({ id })}
        onCancel={() => setAsking(false)}
      >
        <p>{t("documents:receipts.card.cancelText")}</p>
      </ConfirmDialog>
    </section>
  );
}

/** День, время и способ оплаты одной строкой. */
function metaLine(card: ReceiptCard): string {
  const parts = [
    card.receipt.purchaseDate === null ? null : formatDate(card.receipt.purchaseDate),
    card.receipt.purchaseTime === null ? null : formatTime(card.receipt.purchaseTime),
    card.receipt.total === null ? null : formatMoney(card.receipt.total),
  ];
  return parts.filter((part) => part !== null).join(" · ");
}

/** Этапы проверки (RCPT-02, RCPT-06): по этапу чека с сервера; перепроверка называет строки. */
function Checking({
  receipt: card,
  percent,
}: {
  readonly receipt: ReceiptCard;
  readonly percent: number | undefined;
}) {
  const { t } = useTranslation("documents");
  const stage = card.receipt.stage ?? "reading";
  const rechecking = stage === "rechecking";
  const steps: StepItem[] = [
    { id: "read", label: t("receipts.steps.read"), state: stage === "reading" ? "active" : "done" },
    {
      id: "check",
      label: t("receipts.steps.check"),
      state: stage === "reading" ? "pending" : stage === "checking" ? "active" : "done",
    },
    ...(rechecking
      ? [
          {
            id: "recheck",
            label: t("receipts.steps.recheck", { lines: card.receipt.disputedLines.join(", ") }),
            state: "active" as const,
          },
        ]
      : []),
  ];
  return (
    <section
      className={classes.card}
      aria-live="polite"
      aria-busy="true"
      aria-labelledby="receipt-checking"
    >
      <h3 id="receipt-checking" className={classes.cardTitle}>
        {t("receipts.status.processing")}
      </h3>
      <Steps
        label={t("receipts.steps.label")}
        stateLabels={{
          done: t("receipts.steps.state.done"),
          active: t("receipts.steps.state.active"),
          pending: t("receipts.steps.state.pending"),
        }}
        steps={steps}
      />
      {percent !== undefined && <p className={classes.meta}>{percent}%</p>}
    </section>
  );
}

function Failed({
  card,
  onOpen,
}: {
  readonly card: ReceiptCard;
  readonly onOpen: (id: string) => void;
}) {
  const { t } = useTranslation(["documents", "errors"]);
  const { receipt } = card;
  return (
    <output className={`${classes.notice} ${classes.noticeWarn}`}>
      {receipt.duplicateOf !== null ? (
        <>
          <p className={classes.noticeTitle}>
            {t("documents:receipts.card.duplicate", { date: receipt.duplicateOf.date })}
          </p>
          <div className={classes.actions}>
            <Button
              variant="default"
              size="xs"
              onClick={() => onOpen(receipt.duplicateOf?.id ?? "")}
            >
              {t("documents:receipts.card.duplicateOpen")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={classes.noticeTitle}>{t("documents:receipts.card.failed")}</p>
          <p>
            {t(`errors:${errorCodeFrom(receipt.errorCode)}`, {
              name: "",
              date: "",
              retryAfterMinutes: 1,
            })}
          </p>
        </>
      )}
    </output>
  );
}

/** Итог проверки: «сходится» — спокойно; спорные строки — охристая плашка с остатком и «Исправить строки». */
function Verdict({ card, onFix }: { readonly card: ReceiptCard; readonly onFix: () => void }) {
  const { t } = useTranslation("documents");
  const { receipt } = card;
  if (receipt.status !== "needs-review") {
    return receipt.rechecks > 0 ? (
      <p className={classes.meta}>
        {t("receipts.card.rechecked", {
          lines: String(new Set(card.attempts.flatMap((attempt) => attempt.changedLines)).size),
        })}
      </p>
    ) : null;
  }
  const lines = receipt.disputedLines;
  return (
    <div className={`${classes.notice} ${classes.noticeWarn}`}>
      <p className={classes.noticeTitle}>
        {lines.length > 0
          ? t("receipts.card.disputed", { lines: lines.join(" и ") })
          : t("receipts.card.disputedTotal")}
      </p>
      <p>{t("receipts.card.disputedText", { remainder: formatMoney(card.remainder) })}</p>
      <div className={classes.actions}>
        <Button
          variant="default"
          size="xs"
          leftSection={<Pencil size={14} aria-hidden />}
          onClick={onFix}
        >
          {t("receipts.card.fix")}
        </Button>
      </div>
    </div>
  );
}

function OperationNote({ card }: { readonly card: ReceiptCard }) {
  const { t } = useTranslation("documents");
  const text = card.operation?.merged
    ? t("receipts.card.linkedNote")
    : card.operation?.pending
      ? t("receipts.card.pendingNote")
      : t("receipts.card.cashNote");
  return <p className={classes.notice}>{text}</p>;
}

/** «Проверить на сайте МНС» (RCPT-12): ссылка на сервис и копирование УИ и дня — запросов к МНС приложение не делает. */
function Mns({ card }: { readonly card: ReceiptCard }) {
  const { t } = useTranslation("documents");
  const [copied, setCopied] = useState(false);
  if (card.mns === null) return null;
  const text = [card.mns.uid, card.mns.date === null ? null : formatDate(card.mns.date)]
    .filter((part) => part !== null)
    .join(" ");
  return (
    <>
      <Button
        component="a"
        href={MNS_URL}
        target="_blank"
        rel="noopener noreferrer"
        variant="default"
        size="xs"
        leftSection={<ExternalLink size={16} aria-hidden />}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true));
        }}
      >
        {t("receipts.card.mns.button")}
      </Button>
      <p className={classes.meta}>{t("receipts.card.mns.hint")}</p>
      <p className={classes.meta}>{t("receipts.card.uid", { uid: card.mns.uid })}</p>
      <Button
        variant="subtle"
        size="xs"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true));
        }}
      >
        {t("receipts.card.mns.copy")}
      </Button>
      {copied && <output className={classes.copied}>{t("receipts.card.mns.copied")}</output>}
    </>
  );
}
