// Подтверждение массового или удаляющего действия (AGT-07, CHAT-04): результат destructive-инструмента
// `{ ok: true, pending: { decisionId, count } }`. Вопрос читается из `actions.decision` (текст — из словаря по ключу
// решения, как в окне подтверждения), «Да» и «Нет» — `actions.answer`; решение, на которое уже ответили (текстом «да»
// или в другой вкладке), показывается итогом без кнопок. Ничего не исполняется, пока человек не ответил (AGT-07).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Skeleton } from "@mantine/core";
import { ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { decisionText } from "../../../entities/action/index.ts";
import { orpc } from "../../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../../lib/errors.ts";
import { ActionResultCard } from "./ActionResultCard.tsx";
import classes from "./cards.module.css";
import { Unavailable } from "./Unavailable.tsx";

const Pending = z.object({
  ok: z.literal(true),
  pending: z.object({ decisionId: z.uuid(), count: z.number() }),
});

export function ConfirmCard({ output }: { readonly output: unknown }) {
  const parsed = Pending.safeParse(output);
  if (!parsed.success) return null;
  return (
    <PendingDecision
      decisionId={parsed.data.pending.decisionId}
      count={parsed.data.pending.count}
    />
  );
}

function PendingDecision({
  decisionId,
  count,
}: {
  readonly decisionId: string;
  readonly count: number;
}) {
  const { t } = useTranslation(["assistant", "errors"]);
  const { t: decisions } = useTranslation(["common", "decisions"]);
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const [answered, setAnswered] = useState<{
    status: "yes" | "no";
    undoToken: string | null;
  } | null>(null);
  const decision = useQuery(orpc.actions.decision.queryOptions({ input: { id: decisionId } }));
  const answer = useMutation(
    orpc.actions.answer.mutationOptions({
      onSuccess: async (result) => {
        setAnswered({ status: result.status, undoToken: result.undoToken });
        await queryClient.invalidateQueries();
      },
      onError: (error) =>
        setFailure(
          t("assistant:cards.confirm.failed", {
            reason: t(`errors:${errorCodeOf(error)}`, errorParamsOf(error)),
          }),
        ),
    }),
  );
  if (answered !== null) {
    return <ActionResultCard data={{ decisionId, ...answered }} />;
  }
  if (decision.isPending) return <Skeleton height={96} radius="md" />;
  if (decision.isError) return <Unavailable />;
  if (decision.data.status !== "pending") {
    return (
      <ActionResultCard data={{ decisionId, status: decision.data.status, undoToken: null }} />
    );
  }
  const reply = (value: "yes" | "no") => {
    setFailure(null);
    answer.mutate({ id: decisionId, answer: value });
  };
  return (
    <section className={classes.card} aria-label={decisionText(decisions, decision.data.summary)}>
      <p className={classes.line}>
        <ShieldQuestion className={classes.warn} size={18} strokeWidth={1.8} aria-hidden />
        <span className={classes.title}>{decisionText(decisions, decision.data.summary)}</span>
      </p>
      <p className={classes.line}>{t("assistant:cards.confirm.hint")}</p>
      <div className={classes.buttons}>
        <Button size="sm" loading={answer.isPending} onClick={() => reply("yes")}>
          {t("assistant:cards.confirm.yesCount", { count })}
        </Button>
        <Button variant="subtle" size="sm" disabled={answer.isPending} onClick={() => reply("no")}>
          {t("assistant:cards.confirm.no")}
        </Button>
      </div>
      {failure !== null && (
        <p className={classes.error} role="alert">
          {failure}
        </p>
      )}
    </section>
  );
}
