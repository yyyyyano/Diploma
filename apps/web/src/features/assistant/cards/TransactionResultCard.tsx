// Результат add_transaction / update_transaction (AGT-05, P5, CHAT-04): «Записал операцию» с кнопками «Отменить» и
// «Изменить». «Отменить» — `actions.undo` по токену из результата; объект успели поправить — CONFLICT, причина словами.
// «Изменить» открывает операцию в списке (`/operations?op=…`): правка — там, где есть форма и проверки.
import { Transaction, UndoToken } from "@kosht/contract";
import { Button } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Pencil, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { TransactionCard } from "../../../entities/transaction/index.ts";
import { orpc } from "../../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../../lib/errors.ts";
import classes from "./cards.module.css";
import { Unavailable } from "./Unavailable.tsx";

const ChangeOutput = z.object({
  transaction: Transaction,
  undoToken: UndoToken,
  categoryName: z.string().nullable().optional(),
});

export function TransactionResultCard({
  output,
  changed,
}: {
  readonly output: unknown;
  /** update_transaction — «Изменил операцию», иначе «Записал». */
  readonly changed: boolean;
}) {
  const { t } = useTranslation(["assistant", "errors"]);
  const queryClient = useQueryClient();
  const [undone, setUndone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const undo = useMutation(
    orpc.actions.undo.mutationOptions({
      onSuccess: async () => {
        setUndone(true);
        await queryClient.invalidateQueries({ queryKey: orpc.transactions.key() });
        await queryClient.invalidateQueries({ queryKey: orpc.accounts.key() });
      },
      onError: (error) =>
        setFailure(
          t("assistant:cards.transaction.undoFailed", {
            reason: t(`errors:${errorCodeOf(error)}`, errorParamsOf(error)),
          }),
        ),
    }),
  );
  const parsed = ChangeOutput.safeParse(output);
  if (!parsed.success) return <Unavailable />;
  const { transaction, undoToken, categoryName } = parsed.data;
  if (undone) {
    return (
      <p className={classes.line}>
        <Undo2 size={16} strokeWidth={1.8} aria-hidden />
        {t("assistant:cards.transaction.undone")}
      </p>
    );
  }
  const what = categoryName ?? transaction.merchantName ?? transaction.description;
  return (
    <div className={classes.stack}>
      <TransactionCard
        transaction={transaction}
        categoryName={categoryName ?? null}
        heading={t(
          changed ? "assistant:cards.transaction.changed" : "assistant:cards.transaction.added",
        )}
      >
        <Button
          variant="default"
          size="sm"
          leftSection={<Undo2 size={16} strokeWidth={1.8} aria-hidden />}
          loading={undo.isPending}
          aria-label={t("assistant:cards.transaction.undoAria", { what })}
          onClick={() => {
            setFailure(null);
            undo.mutate({ token: undoToken });
          }}
        >
          {t("assistant:cards.transaction.undo")}
        </Button>
        <Link to="/operations" search={{ op: transaction.id }} className={classes.linkButton}>
          <Pencil size={16} strokeWidth={1.8} aria-hidden />
          {t("assistant:cards.transaction.edit")}
        </Link>
      </TransactionCard>
      {failure !== null && (
        <p className={classes.error} role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}
