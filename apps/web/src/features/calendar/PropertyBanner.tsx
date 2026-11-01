// Баннер «У вас есть автомобиль?» (design/screens/Calendar.dc.html; PROF-07): один вопрос об имуществе — предположение системы по
// операциям (топливо, платёж страховщику, уплата налога) или единственный вопрос про автомобиль при первом открытии календаря.
// «Да» и «Нет» — факт профиля с «Отменить» (тост страницы); после ответа налоги и страховки пересчитываются на сервере сразу.
import type { PropertyKind } from "@kosht/contract";
import { Button } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Car, Check, Home, Trees } from "lucide-react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../lib/errors.ts";
import classes from "./CalendarPage.module.css";

const ICONS = { car: Car, apartment: Home, land: Trees } as const;

export interface PropertyBannerProps {
  /** «Отменить» ответ: токен и текст тоста. */
  readonly onAnswered: (token: string, message: string) => void;
  readonly onError: (message: string) => void;
}

export function PropertyBanner({ onAnswered, onError }: PropertyBannerProps) {
  const { t } = useTranslation(["calendar", "errors"]);
  const queryClient = useQueryClient();
  const question = useQuery(orpc.calendar.propertyQuestion.queryOptions());
  const answer = useMutation(
    orpc.calendar.answerProperty.mutationOptions({
      onSuccess: ({ undoToken }, input) => {
        void queryClient.invalidateQueries({ queryKey: orpc.calendar.key() });
        onAnswered(
          undoToken,
          t(`calendar:property.toast.${input.has ? "yes" : "no"}.${input.kind}`),
        );
      },
      onError: (error) => onError(t(`errors:${errorCodeOf(error)}`, errorParamsOf(error))),
    }),
  );
  const current = question.data?.question ?? null;
  if (current === null) return null;
  const kind: PropertyKind = current.kind;
  const Icon = ICONS[kind];
  const ask = (has: boolean) => answer.mutate({ kind, has });
  return (
    <section className={classes.banner} aria-labelledby="property-question">
      <span className={classes.bannerIcon} aria-hidden>
        <Icon size={22} />
      </span>
      <div className={classes.bannerText}>
        <h2 id="property-question" className={classes.bannerTitle}>
          {t(`calendar:property.title.${kind}.${current.evidence === null ? "ask" : "found"}`)}
        </h2>
        <p className={classes.bannerHint}>
          {t(`calendar:property.text.${kind}.${current.evidence ?? "ask"}`)}
        </p>
      </div>
      <div className={classes.bannerActions}>
        <Button
          size="sm"
          leftSection={<Check size={16} aria-hidden />}
          loading={answer.isPending}
          onClick={() => ask(true)}
        >
          {t(`calendar:property.yes.${kind}`)}
        </Button>
        <Button size="sm" variant="default" disabled={answer.isPending} onClick={() => ask(false)}>
          {t("calendar:property.no")}
        </Button>
      </div>
    </section>
  );
}
