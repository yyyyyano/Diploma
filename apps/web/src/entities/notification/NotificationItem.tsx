// Уведомление в ленте (NOTIF-01, NOTIF-05; design/screens/Main.dc.html — Main--notifications): значок вида, текст из
// словаря по виду, день, кнопки действия. «Да / Нет» — прямо в actions.answer по decisionId, «Отменить» — в
// actions.undo по undoToken, «Показать» — ссылка на объект. Нажатие на любую кнопку отмечает уведомление прочитанным.
import type { UserNotification } from "@kosht/contract";
import { formatDayTime, formatMoney } from "@kosht/i18n";
import { DEFAULT_TIME_ZONE, LocalDate, Money, timeOfDay } from "@kosht/kernel";
import { Button } from "@mantine/core";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Download,
  FileText,
  Link2,
  Percent,
  Repeat,
  ShieldCheck,
  Target,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { orpc } from "../../lib/api.ts";
import { categoryRefOf, useCategoryLookup } from "../category/index.ts";
import classes from "./NotificationItem.module.css";

const ICONS: Readonly<Record<UserNotification["kind"], LucideIcon>> = {
  limit: AlertTriangle,
  goal: Target,
  deduction: Percent,
  "receipt-match": Link2,
  "receipt-review": AlertTriangle,
  "statement-imported": FileText,
  "calendar-reminder": CalendarClock,
  "insurance-renewal": ShieldCheck,
  "weekly-summary": TrendingUp,
  "recurring-missed": Repeat,
  "data-export-ready": Download,
};

/** Куда ведёт «Показать»: раздел объекта; неизвестный вид объекта — кнопки нет. */
const OBJECT_HREF: Readonly<Record<string, (id: string) => string>> = {
  transaction: (id) => `/operations?open=${encodeURIComponent(id)}`,
  receipt: (id) => `/documents?open=${encodeURIComponent(id)}`,
  "statement-import": () => "/documents",
  limit: () => "/budget",
  goal: () => "/budget",
  deduction: () => "/deductions",
  "calendar-event": () => "/calendar",
  recurring: () => "/recurring",
  "data-export": () => "/settings?tab=my-data",
};

export function objectHref(ref: UserNotification["objectRef"]): string | undefined {
  return ref === null ? undefined : OBJECT_HREF[ref.entity]?.(ref.id);
}

/** День и время уведомления («сегодня, 09:00», «вчера, 18:40», «21.10.2026, 09:00»; CAL-07: напоминание — не только день). */
function dayOf(iso: string): string {
  const day = (instant: Date) => LocalDate.fromInstant(instant, DEFAULT_TIME_ZONE);
  const at = new Date(iso);
  return formatDayTime(day(at), timeOfDay(at, DEFAULT_TIME_ZONE), day(new Date()));
}

export interface NotificationItemProps {
  readonly notification: UserNotification;
  readonly onRead: (id: string) => void;
}

export function NotificationItem({ notification, onRead }: NotificationItemProps) {
  const { t } = useTranslation(["notifications", "common"]);
  const [done, setDone] = useState<string | undefined>();
  const answer = useMutation(
    orpc.actions.answer.mutationOptions({
      onSuccess: (result) =>
        setDone(
          result.status === "yes"
            ? t("notifications:actions.answeredYes")
            : t("notifications:actions.answeredNo"),
        ),
    }),
  );
  const undo = useMutation(
    orpc.actions.undo.mutationOptions({
      onSuccess: () => setDone(t("notifications:actions.undone")),
    }),
  );
  const Icon = ICONS[notification.kind] ?? Bell;
  const href = objectHref(notification.objectRef);
  const read = () => {
    if (!notification.read) onRead(notification.id);
  };
  const { decisionId, undoToken } = notification;
  // Подстановки текстов с параметрами (receipt-match: магазин и дни); без параметров в записи — пустые.
  const lookup = useCategoryLookup();
  const params = { store: "", date: "", bankDate: "", ...notification.params };
  const num = (key: string) => Number(notification.params[key] ?? 0);
  // BUD-03, BUD-07: текст лимита и цели — по параметрам; деньги в параметрах — копейки, категорию называет справочник.
  let textKey = `notifications:kinds.${notification.kind}.text`;
  if (notification.kind === "limit") {
    const ref = categoryRefOf(String(notification.params["category"] ?? ""));
    textKey = `notifications:kinds.limit.${num("threshold") >= 100 ? "text100" : "text80"}`;
    Object.assign(params, {
      category: ref === undefined ? "" : lookup.nameOf(ref),
      spent: formatMoney(Money.of(num("spent"), "BYN")),
      limit: formatMoney(Money.of(num("limit"), "BYN")),
    });
  } else if (notification.kind === "deduction") {
    // TAX-20: текст по виду вычета; сумма в параметрах — копейки BYN (у жилья суммы нет).
    const variants: Record<string, string> = {
      education: "textEducation",
      children: "textChildren",
      housing: "textHousing",
    };
    textKey = `notifications:kinds.deduction.${variants[String(notification.params["kind"] ?? "")] ?? "text"}`;
    Object.assign(params, { amount: formatMoney(Money.of(num("amount"), "BYN")) });
  } else if (notification.kind === "insurance-renewal") {
    // CAL-05: вопрос «напомнить о продлении?» — по виду страховки; дни — готовой строкой «ДД.ММ.ГГГГ».
    const variants: Record<string, string> = { osago: "textOsago", kasko: "textKasko" };
    textKey = `notifications:kinds.insurance-renewal.${variants[String(notification.params["kind"] ?? "")] ?? "text"}`;
    Object.assign(params, {
      paidOn: String(notification.params["paidOn"] ?? ""),
      remindOn: String(notification.params["remindOn"] ?? ""),
    });
  } else if (notification.kind === "calendar-reminder") {
    // CAL-07: «когда» — по числу дней до события; гарантия и срок по правилу — свои тексты, прочее — название события.
    const days = num("days");
    const base = "notifications:kinds.calendar-reminder";
    const when =
      days <= 0
        ? t(`${base}.when.today`)
        : days === 1
          ? t(`${base}.when.tomorrow`)
          : t(`${base}.when.days`, { count: days });
    const type = String(notification.params["type"] ?? "own");
    const title = String(notification.params["title"] ?? "");
    const rule = String(notification.params["rule"] ?? "");
    const ruleName = t(`${base}.rules.${rule}` as never, { defaultValue: "" });
    Object.assign(params, {
      when,
      title,
      type: t(`${base}.types.${type}` as never),
      rule: ruleName,
    });
    textKey =
      type === "warranty" && title !== ""
        ? `${base}.textWarranty`
        : rule !== "" && ruleName !== ""
          ? `${base}.textRule`
          : title !== ""
            ? `${base}.textEvent`
            : `${base}.textType`;
  } else if (notification.kind === "goal") {
    const reason = String(notification.params["reason"] ?? "");
    const variants: Record<string, string> = {
      half: "textHalf",
      done: "textDone",
      behind: "textBehind",
    };
    textKey = `notifications:kinds.goal.${variants[reason] ?? "text"}`;
  }
  return (
    <article className={classes.item} data-unread={!notification.read}>
      <span className={classes.icon} data-kind={notification.kind}>
        <Icon size={18} strokeWidth={1.8} aria-hidden />
      </span>
      <div className={classes.body}>
        <p className={classes.text}>
          {!notification.read && (
            <span className={classes.srOnly}>{t("notifications:unread")}: </span>
          )}
          {
            // TXN-10: автоматическая привязка чека и вопрос «одна покупка?» — один вид, два текста (кнопки у них разные).
            notification.kind === "receipt-match" && undoToken !== null
              ? t("notifications:kinds.receipt-match.textLinked", params)
              : t(textKey as never, params)
          }
        </p>
        <p className={classes.time}>
          <time dateTime={notification.createdAt}>{dayOf(notification.createdAt)}</time>
        </p>
        {done !== undefined ? (
          <output className={classes.done}>{done}</output>
        ) : (
          <div className={classes.actions}>
            {href !== undefined && (
              <Button component="a" href={href} size="xs" variant="default" onClick={read}>
                {t("notifications:actions.show")}
              </Button>
            )}
            {decisionId !== null && (
              <>
                <Button
                  size="xs"
                  loading={answer.isPending}
                  onClick={() => {
                    read();
                    answer.mutate({ id: decisionId, answer: "yes" });
                  }}
                >
                  {t("notifications:actions.yes")}
                </Button>
                <Button
                  size="xs"
                  variant="default"
                  disabled={answer.isPending}
                  onClick={() => {
                    read();
                    answer.mutate({ id: decisionId, answer: "no" });
                  }}
                >
                  {t("notifications:actions.no")}
                </Button>
              </>
            )}
            {undoToken !== null && (
              <Button
                size="xs"
                variant="default"
                loading={undo.isPending}
                onClick={() => {
                  read();
                  undo.mutate({ token: undoToken });
                }}
              >
                {notification.kind === "receipt-match"
                  ? t("notifications:actions.differentPurchases")
                  : t("notifications:actions.undo")}
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
