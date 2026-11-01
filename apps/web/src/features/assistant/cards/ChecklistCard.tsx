// Чек-лист документов (`get_checklist`, LEGAL-12, CHAT-04): шаблон из кода, а не текст модели; галочки сохраняются на
// сервере за этим сообщением (`legalConsult.setChecked`, subject `message`). Из результата инструмента берётся только id
// шаблона — состояние и тексты приходят процедурой `legalConsult.checklist`, чтобы не показывать устаревшие галочки.
// Норма — чип со ссылкой на pravo.by; «текста нормы в базе нет» — явная пометка (сейчас её нет ни у одного пункта: ст. 211, 222, 223 НК сохранены).
import { ChecklistId, type ChecklistView } from "@kosht/contract";
import { Checkbox, Skeleton } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { orpc } from "../../../lib/api.ts";
import { LawRefChip } from "../../../ui/index.ts";
import classes from "./ChecklistCard.module.css";
import cardClasses from "./cards.module.css";
import { Unavailable } from "./Unavailable.tsx";

const Output = z.object({ id: ChecklistId });
const UUID = z.uuid();

export function ChecklistCard({
  output,
  messageId,
}: {
  readonly output: unknown;
  readonly messageId: string;
}) {
  const parsed = Output.safeParse(output);
  if (!parsed.success) return null;
  return <Checklist id={parsed.data.id} messageId={messageId} />;
}

function Checklist({ id, messageId }: { readonly id: ChecklistId; readonly messageId: string }) {
  const { t } = useTranslation("assistant");
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  // Сообщение без своего id (локальное, до ответа сервера) делит «общее» состояние шаблона.
  const subject = UUID.safeParse(messageId).success
    ? ({ kind: "message", id: messageId } as const)
    : ({ kind: "general" } as const);
  const options = orpc.legalConsult.checklist.queryOptions({ input: { id, subject } });
  const view = useQuery(options);
  const toggle = useMutation(
    orpc.legalConsult.setChecked.mutationOptions({
      onSuccess: (next: ChecklistView) => {
        setFailed(false);
        queryClient.setQueryData(options.queryKey, next);
      },
      onError: () => setFailed(true),
    }),
  );
  if (view.isPending) return <Skeleton height={140} radius="md" />;
  if (view.isError) return <Unavailable />;
  const checklist = view.data;
  const progress = t("cards.checklist.progress", { done: checklist.done, total: checklist.total });
  return (
    <section className={classes.card} aria-labelledby={`cl-${messageId}-${id}`}>
      <h4 className={classes.title} id={`cl-${messageId}-${id}`}>
        <ListChecks size={18} strokeWidth={1.8} aria-hidden />
        {checklist.title}
      </h4>
      <p
        className={classes.progress}
        aria-label={t("cards.checklist.progressLabel", { title: checklist.title })}
      >
        {progress}
      </p>
      <ul className={classes.items}>
        {checklist.items.map((item) => (
          <li key={item.id} className={classes.item}>
            {item.checked === null ? (
              <p className={classes.note}>
                <span className={classes.kind}>{t("cards.checklist.note")}</span> {item.text}
              </p>
            ) : (
              <Checkbox
                checked={item.checked}
                disabled={toggle.isPending}
                label={item.text}
                onChange={(event) =>
                  toggle.mutate({ id, subject, item: item.id, done: event.currentTarget.checked })
                }
              />
            )}
            <div className={classes.meta}>
              {item.instance !== null && (
                <span>{t("cards.checklist.instance", { text: item.instance.label })}</span>
              )}
              {item.deadline !== null && (
                <span>{t("cards.checklist.deadline", { text: item.deadline })}</span>
              )}
              {item.norm !== null && (
                <>
                  <LawRefChip label={item.norm.ref} href={item.norm.url} external />
                  {item.norm.unsaved && <span>{t("cards.checklist.unsaved")}</span>}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {failed && (
        <p className={cardClasses.error} role="alert">
          {t("cards.checklist.saveError")}
        </p>
      )}
    </section>
  );
}
