// Блок чеков экрана «Чеки и документы» (design/screens/Documents.dc.html, RCPT-01, RCPT-02, RCPT-07, RCPT-08): карточка
// «Сканировать чек» (кнопка, перетаскивание; до 10 фото за раз; поле без `capture` — на телефоне браузер сам предложит
// «Камера / Галерея»), проверка по этапам, карточка результата и список чеков. Числа и статус считает сервер (P1).
// Ход распознавания — события потока (receipt): страница перезапрашивает чек сама.
import { MAX_RECEIPTS_PER_START, type ReceiptSummary } from "@kosht/contract";
import { formatDate, formatMoney, formatTime } from "@kosht/i18n";
import { Button, VisuallyHidden } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, ChevronRight, Receipt } from "lucide-react";
import { useRef, useState, type DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { ReceiptStatusBadge } from "../../../entities/receipt/index.ts";
import { orpc } from "../../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../../lib/errors.ts";
import { SkeletonCard } from "../../../ui/index.ts";
import { ReceiptCardView } from "./ReceiptCardView.tsx";
import classes from "./ReceiptsSection.module.css";

export function ReceiptsSection({
  openId,
  onOpen,
}: {
  readonly openId: string | null;
  readonly onOpen: (id: string | null) => void;
}) {
  const { t } = useTranslation(["documents", "errors"]);
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const list = useQuery(orpc.receipts.list.queryOptions());

  const upload = useMutation({
    mutationFn: async (files: readonly File[]) => {
      const saved = await orpc.files.upload.call({ kind: "receipt-photo", files: [...files] });
      return orpc.receipts.start.call({ fileIds: saved.files.map((file) => file.id) });
    },
    onSuccess: async ({ items }) => {
      setNotice(null);
      // Каждое фото — своя задача (RCPT-01); открывается первое: остальные видны в списке.
      const first = items[0];
      if (first !== undefined) onOpen(first.id);
      await queryClient.invalidateQueries({ queryKey: orpc.receipts.key() });
    },
    onError: (error) =>
      setNotice(
        t("documents:receipts.scan.error", {
          reason: t(`errors:${errorCodeOf(error)}`, errorParamsOf(error)),
        }),
      ),
  });

  const pick = (files: readonly File[]) => {
    if (files.length === 0) return;
    if (files.length > MAX_RECEIPTS_PER_START) {
      setNotice(t("documents:receipts.scan.tooMany", { count: MAX_RECEIPTS_PER_START }));
      return;
    }
    upload.mutate(files);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    pick([...event.dataTransfer.files]);
  };

  const items = list.data?.items;
  return (
    <section className={classes.section} aria-labelledby="receipts-heading">
      <h2 id="receipts-heading" className={classes.scanTitle}>
        {t("documents:receipts.heading")}
      </h2>
      <div
        className={classes.scan}
        data-over={over}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <span className={classes.scanIcon} aria-hidden>
          <Camera size={22} />
        </span>
        <div className={classes.scanText}>
          <p className={classes.scanTitle}>
            {over ? t("documents:receipts.scan.drop") : t("documents:receipts.scan.title")}
          </p>
          <p className={classes.hint}>{t("documents:receipts.scan.text")}</p>
          <p className={classes.hint}>{t("documents:receipts.scan.hint")}</p>
        </div>
        {/* Без capture: браузер на телефоне предложит «Камера / Галерея», на компьютере — выбор файла. */}
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept="image/*,.heic"
          aria-label={t("documents:receipts.scan.label")}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = "";
            pick(files);
          }}
        />
        <Button loading={upload.isPending} onClick={() => input.current?.click()}>
          {t("documents:receipts.scan.button")}
        </Button>
      </div>
      {notice !== null && (
        <p className={classes.error} role="alert">
          <AlertTriangle size={18} aria-hidden />
          {notice}
        </p>
      )}
      {openId !== null && (
        <ReceiptCardView key={openId} id={openId} onOpen={onOpen} onClose={() => onOpen(null)} />
      )}
      {list.isPending && <SkeletonCard />}
      {items !== undefined && items.length === 0 && openId === null && (
        <p className={classes.hint}>{t("documents:receipts.list.empty")}</p>
      )}
      {items !== undefined && items.length > 0 && (
        <ul className={classes.list} aria-label={t("documents:receipts.heading")}>
          {items.map((item) => (
            <ReceiptRow
              key={item.id}
              item={item}
              current={item.id === openId}
              onOpen={() => onOpen(item.id)}
            />
          ))}
        </ul>
      )}
      <HowItWorks />
    </section>
  );
}

function ReceiptRow({
  item,
  current,
  onOpen,
}: {
  readonly item: ReceiptSummary;
  readonly current: boolean;
  readonly onOpen: () => void;
}) {
  const { t } = useTranslation("documents");
  const when = [
    item.purchaseDate === null ? null : formatDate(item.purchaseDate),
    item.purchaseTime === null ? null : formatTime(item.purchaseTime),
  ]
    .filter((part) => part !== null)
    .join(", ");
  return (
    <li>
      <button type="button" className={classes.row} aria-current={current} onClick={onOpen}>
        <span>
          <p className={classes.rowTitle}>
            <Receipt size={16} aria-hidden /> {item.storeName ?? t("receipts.list.store")}
          </p>
          <p className={classes.meta}>{when}</p>
        </span>
        <span className={classes.rowSide}>
          {item.total !== null && <strong>{formatMoney(item.total)}</strong>}
          <ReceiptStatusBadge receipt={item} />
          <ChevronRight size={16} aria-hidden />
          <VisuallyHidden>{t("receipts.list.open")}</VisuallyHidden>
        </span>
      </button>
    </li>
  );
}

function HowItWorks() {
  const { t } = useTranslation("documents");
  return (
    <section className={classes.card} aria-labelledby="receipts-how">
      <h3 id="receipts-how" className={classes.scanTitle}>
        {t("receipts.how.title")}
      </h3>
      <ol className={classes.how}>
        <li>{t("receipts.how.one")}</li>
        <li>{t("receipts.how.two")}</li>
        <li>{t("receipts.how.three")}</li>
      </ol>
    </section>
  );
}
