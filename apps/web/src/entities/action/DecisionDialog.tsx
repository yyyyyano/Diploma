// Ожидающее решение «Да/Нет» на сайте (AGT-07, NOTIF-05): ConfirmDialog дизайн-системы, подключённый к actions —
// вопрос из словаря по ключу решения (`decisions.<вид>` + параметры), «Да» и «Нет» — actions.answer по id; повторный
// ответ сервер не исполняет. Закрыть окно — не ответить.
import type { DecisionSummary } from "@kosht/contract";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import { ConfirmDialog } from "../../ui/index.ts";

/** Вопрос решения: ключ «decisions.<вид>» → «decisions:<вид>» с параметрами; нет текста — запасной. */
export function decisionText(
  t: TFunction<readonly ["common", "decisions"]>,
  summary: z.infer<typeof DecisionSummary>,
): string {
  const [namespace = "", ...rest] = summary.key.split(".");
  return t(`${namespace}:${rest.join(".")}`, {
    ...summary.params,
    defaultValue: t("decisions:fallback"),
  });
}

export interface DecisionDialogProps {
  readonly decisionId: string;
  readonly opened: boolean;
  readonly onClose: () => void;
  /** undoToken — «Отменить» сразу после «Да» (удаление операций, TXN-03); у «Нет» и у повтора — null. */
  readonly onAnswered?: (status: "yes" | "no", undoToken: string | null) => void;
  /** Кнопка-глагол «Да» с числом («Да, перенести 13»); без неё — «Да, выполнить». */
  readonly confirmLabel?: string;
}

export function DecisionDialog({
  decisionId,
  opened,
  onClose,
  onAnswered,
  confirmLabel,
}: DecisionDialogProps) {
  const { t } = useTranslation(["common", "decisions", "errors"]);
  const [failure, setFailure] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const decision = useQuery({
    ...orpc.actions.decision.queryOptions({ input: { id: decisionId } }),
    enabled: opened,
  });
  const answer = useMutation(
    orpc.actions.answer.mutationOptions({
      onSuccess: async (result) => {
        await queryClient.invalidateQueries({ queryKey: orpc.actions.decision.key() });
        onAnswered?.(result.status, result.undoToken ?? null);
        onClose();
      },
      // «Да» не прошло: причина по-человечески. Конфликт с причиной (счёт с операциями) — свой текст из
      // decisions:conflict.<причина>, остальное — по коду каталога ошибок.
      onError: (error) => {
        const code = errorCodeOf(error);
        const params = errorParamsOf(error);
        const reason = params["reason"];
        setFailure(
          code === "CONFLICT" && typeof reason === "string"
            ? t(`decisions:conflict.${reason}`, { defaultValue: t("errors:CONFLICT") })
            : t(`errors:${code}`, params),
        );
      },
    }),
  );
  const summary = decision.data?.summary;
  return (
    <ConfirmDialog
      opened={opened && decision.data?.status === "pending"}
      title={t("common:decision.title")}
      confirmLabel={confirmLabel ?? t("common:decision.yes")}
      pending={answer.isPending}
      onConfirm={() => {
        setFailure(null);
        answer.mutate({ id: decisionId, answer: "yes" });
      }}
      onCancel={onClose}
    >
      <p>{summary === undefined ? "" : decisionText(t, summary)}</p>
      {failure !== null && <p role="alert">{failure}</p>}
    </ConfirmDialog>
  );
}
