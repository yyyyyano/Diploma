// Итог «Да»/«Нет» на ожидающее решение (`data-action-result`, AGT-07, P5): ответ пришёл без модели. «Да» — «Готово» и «Отменить»
// по токену; «Нет» — «Хорошо, ничего не меняю».
import { ActionResultData } from "@kosht/contract";
import { Button } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Undo2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../../lib/errors.ts";
import classes from "./cards.module.css";
import { Unavailable } from "./Unavailable.tsx";

export function ActionResultCard({ data }: { readonly data: unknown }) {
  const { t } = useTranslation(["assistant", "errors"]);
  const queryClient = useQueryClient();
  const [undone, setUndone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const undo = useMutation(
    orpc.actions.undo.mutationOptions({
      onSuccess: async () => {
        setUndone(true);
        await queryClient.invalidateQueries();
      },
      onError: (error) => setFailure(t(`errors:${errorCodeOf(error)}`, errorParamsOf(error))),
    }),
  );
  const parsed = ActionResultData.safeParse(data);
  if (!parsed.success) return <Unavailable />;
  const { status, undoToken } = parsed.data;
  if (status === "no") {
    return (
      <p className={classes.line}>
        <X size={16} strokeWidth={1.8} aria-hidden />
        {t("assistant:cards.result.declined")}
      </p>
    );
  }
  if (undone) {
    return (
      <p className={classes.line}>
        <Undo2 size={16} strokeWidth={1.8} aria-hidden />
        {t("assistant:cards.result.undone")}
      </p>
    );
  }
  return (
    <div className={classes.card}>
      <p className={classes.line}>
        <CircleCheck className={classes.ok} size={18} strokeWidth={1.8} aria-hidden />
        {t("assistant:cards.result.done")}
      </p>
      {undoToken !== null && (
        <div className={classes.buttons}>
          <Button
            variant="default"
            size="sm"
            leftSection={<Undo2 size={16} strokeWidth={1.8} aria-hidden />}
            loading={undo.isPending}
            onClick={() => {
              setFailure(null);
              undo.mutate({ token: undoToken });
            }}
          >
            {t("assistant:cards.result.undo")}
          </Button>
        </div>
      )}
      {failure !== null && (
        <p className={classes.error} role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}
