// Карточка события календаря в чате (`create_event`, CAL-06, AGT-05, CHAT-04): «Создал событие» — название, день, когда напомню,
// «Отменить» по токену и «Показать в календаре». Результат берётся из ответа инструмента как есть: даты и суммы приходят с сервера (P1).
import { CalendarEntry, UndoToken } from "@kosht/contract";
import { Button } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  EventBadge,
  eventTitle,
  fullDate,
  useCalendarTexts,
} from "../../../entities/calendar-event/index.ts";
import { orpc } from "../../../lib/api.ts";
import { errorCodeOf, errorParamsOf } from "../../../lib/errors.ts";
import { Money } from "../../../ui/index.ts";
import classes from "./cards.module.css";
import { Unavailable } from "./Unavailable.tsx";

const CreatedEvent = z.object({ event: CalendarEntry, undoToken: UndoToken });

export function EventCard({ output }: { readonly output: unknown }) {
  useCalendarTexts();
  const { t } = useTranslation(["calendar", "notifications", "decisions", "errors", "common"]);
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
  const parsed = CreatedEvent.safeParse(output);
  if (!parsed.success) return <Unavailable />;
  const { event, undoToken } = parsed.data;
  if (undone) {
    return (
      <p className={classes.line}>
        <Undo2 size={16} strokeWidth={1.8} aria-hidden />
        {t("calendar:card.undone")}
      </p>
    );
  }
  const list = [...event.remindDays]
    .toSorted((a, b) => b - a)
    .map((d) => String(t(`calendar:event.remind.${String(d)}` as never)).toLowerCase())
    .join(t("calendar:card.listJoin"));
  return (
    <div className={classes.card}>
      <div className={classes.line}>
        <EventBadge type={event.type} />
        <div>
          <p className={classes.small}>
            <CircleCheck className={classes.ok} size={14} strokeWidth={1.8} aria-hidden />{" "}
            {t("calendar:card.created")}
          </p>
          <p className={classes.title}>{eventTitle(t, event)}</p>
          <p className={classes.small}>
            {event.on === null ? "" : fullDate(t, event.on)}
            {event.remindDays.length === 0
              ? ` · ${t("calendar:card.remindNone")}`
              : ` · ${t("calendar:card.remindText", { list })}`}
          </p>
          {event.amount !== null && <Money value={event.amount} kind="expense" />}
        </div>
      </div>
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
          {t("calendar:card.undo")}
        </Button>
        <a className={classes.linkButton} href={`/calendar?event=${encodeURIComponent(event.id)}`}>
          {t("calendar:card.show")}
        </a>
      </div>
      {failure !== null && (
        <p className={classes.error} role="alert">
          {failure}
        </p>
      )}
    </div>
  );
}
