// Чек-лист документов с галочками (LEGAL-12, CHAT-04, TAX-06): шаблон из кода, а не текст модели; галочки сохраняются на сервере
// за субъектом (сообщение чата или общий список — `legalConsult.setChecked`). Тексты и состояние приходят процедурой
// `legalConsult.checklist`, чтобы не показывать устаревшие галочки. Норма — чип со ссылкой на pravo.by; «текста нормы в базе нет» —
// явная пометка (сейчас её нет ни у одного пункта: ст. 211, 222, 223 НК сохранены). Виджет общий: карточка в чате и экран
// «Налоговые вычеты» (вторая фича — значит, он в `entities`).
import { assistantTexts } from "@kosht/i18n";
import type { ChecklistId, ChecklistSubject, ChecklistView } from "@kosht/contract";
import { Checkbox, Skeleton } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Info, ListChecks } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { LawRefChip } from "../../ui/index.ts";
import classes from "./Checklist.module.css";

/** Словарь `assistant` (подписи чек-листа) — в i18next до первого показа: он не входит в первую загрузку сайта. */
export function useChecklistTexts(): void {
  const { i18n } = useTranslation();
  if (!i18n.hasResourceBundle("ru", "assistant")) {
    i18n.addResourceBundle("ru", "assistant", assistantTexts, true, true);
  }
}

export function Checklist({
  id,
  subject,
}: {
  readonly id: ChecklistId;
  readonly subject: ChecklistSubject;
}) {
  useChecklistTexts();
  const { t } = useTranslation("assistant");
  const queryClient = useQueryClient();
  const headingId = useId();
  const [failed, setFailed] = useState(false);
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
  if (view.isError) {
    return (
      <p className={classes.line}>
        <Info size={16} strokeWidth={1.8} aria-hidden />
        {t("cards.unavailable")}
      </p>
    );
  }
  const checklist = view.data;
  const progress = t("cards.checklist.progress", { done: checklist.done, total: checklist.total });
  return (
    <section className={classes.card} aria-labelledby={headingId}>
      <h4 className={classes.title} id={headingId}>
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
        <p className={classes.error} role="alert">
          {t("cards.checklist.saveError")}
        </p>
      )}
    </section>
  );
}
