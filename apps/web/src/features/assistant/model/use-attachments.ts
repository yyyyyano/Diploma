// Вложения поля вопроса (CHAT-03, SEC-03): файл уходит теми же процедурами, что и в разделе «Чеки и документы» —
// `files.upload` (тип проверяет сервер по содержимому) → `receipts.start` / `statements.start`, поэтому конвейеры и
// проверки одни. Здесь остаётся только ссылка (вид и id) — её `chat.send` кладёт в ответ карточкой. Убрать вложение
// из сообщения можно до отправки; принятый чек или выписка остаются в разделе документов, как после обычной загрузки.
import { MAX_ATTACHMENTS, type ChatAttachment } from "@kosht/contract";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../../lib/errors.ts";

export interface PendingAttachment extends ChatAttachment {
  /** Имя файла для подписи чипа («чек.jpg»). */
  readonly name: string;
}

export interface Attachments {
  readonly items: readonly PendingAttachment[];
  readonly uploading: boolean;
  /** Готовый текст ошибки или `undefined`. */
  readonly error: string | undefined;
  /** Больше вложений в одно сообщение не взять. */
  readonly full: boolean;
  readonly attach: (kind: ChatAttachment["kind"], files: readonly File[]) => Promise<void>;
  readonly remove: (id: string) => void;
  readonly clear: () => void;
}

export function useAttachments(): Attachments {
  const { t } = useTranslation(["assistant", "errors"]);
  const [items, setItems] = useState<readonly PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const attach = useCallback(
    async (kind: ChatAttachment["kind"], files: readonly File[]) => {
      const room = MAX_ATTACHMENTS - items.length;
      const chosen = files.slice(0, Math.max(0, room));
      if (chosen.length === 0) return;
      setUploading(true);
      setError(undefined);
      try {
        const saved = await orpc.files.upload.call({
          kind: kind === "receipt" ? "receipt-photo" : "statement",
          files: kind === "receipt" ? chosen : chosen.slice(0, 1),
        });
        const nameOf = (fileId: string) =>
          saved.files.find((file) => file.id === fileId)?.name ?? "";
        if (kind === "receipt") {
          const started = await orpc.receipts.start.call({
            fileIds: saved.files.map((file) => file.id),
          });
          setItems((current) => [
            ...current,
            ...started.items.map((item) => ({
              kind,
              id: item.id,
              name: nameOf(item.fileId),
            })),
          ]);
        } else {
          const first = saved.files[0];
          if (first === undefined) return;
          const started = await orpc.statements.start.call({ fileId: first.id });
          setItems((current) => [...current, { kind, id: started.id, name: first.name }]);
        }
      } catch (cause) {
        setError(
          t("assistant:attach.failed", {
            reason: t(`errors:${errorCodeOf(cause)}`, errorParamsOf(cause)),
          }),
        );
      } finally {
        setUploading(false);
      }
    },
    [items.length, t],
  );

  return {
    items,
    uploading,
    error,
    full: items.length >= MAX_ATTACHMENTS,
    attach,
    remove: (id) => setItems((current) => current.filter((item) => item.id !== id)),
    clear: () => {
      setItems([]);
      setError(undefined);
    },
  };
}
