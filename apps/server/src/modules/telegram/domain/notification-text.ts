// Текст уведомления для бота (TG-06, NOTIF-01…05): по виду и параметрам, как на сайте (`NotificationItem`): деньги в параметрах —
// копейки BYN, категорию называет справочник (`categoryName`), «когда» календаря — по числу дней. Словарь — `notifications`
// (`@kosht/i18n`), текст «Итогов недели» бот берёт у `weekly` отдельно (здесь — заглушка вида).
import type { UserNotification } from "@kosht/contract";
import { formatMoney, type T } from "@kosht/i18n";
import { Money } from "@kosht/kernel";

export interface NotificationView {
  readonly text: string;
  /** «Показать»: раздел сайта (из `objectRef`) или команда бота (лимиты и цели — `/limits`). */
  readonly show:
    | { readonly command: "limits" }
    | { readonly objectRef: NonNullable<UserNotification["objectRef"]> }
    | undefined;
}

const bynOf = (value: unknown): string => formatMoney(Money.of(Number(value ?? 0), "BYN"));

/** Ключ словаря и параметры по виду; один путь для всех видов, без текстов, которых нет в словаре. */
export function notificationView(
  t: T,
  notification: UserNotification,
  categoryName: (categoryKey: string) => string,
): NotificationView {
  const { params } = notification;
  // Ключи собираются по виду и параметрам, поэтому типизированный `t` здесь — обычная функция «ключ, параметры → текст».
  const translate = t as unknown as (key: string, options?: object) => string;
  const text = (key: string, values: Record<string, unknown> = {}): string =>
    translate(`notifications:kinds.${key}`, { ...params, ...values });
  const num = (key: string) => Number(params[key] ?? 0);
  const str = (key: string) => String(params[key] ?? "");
  const objectRef = notification.objectRef;
  const onObject = objectRef === null ? undefined : ({ objectRef } as const);

  switch (notification.kind) {
    case "limit":
      return {
        text: text(num("threshold") >= 100 ? "limit.text100" : "limit.text80", {
          category: categoryName(str("category")),
          spent: bynOf(params["spent"]),
          limit: bynOf(params["limit"]),
        }),
        show: { command: "limits" },
      };
    case "goal": {
      const variants: Record<string, string> = {
        half: "textHalf",
        done: "textDone",
        behind: "textBehind",
      };
      return {
        text: text(`goal.${variants[str("reason")] ?? "text"}`),
        show: { command: "limits" },
      };
    }
    case "deduction": {
      const variants: Record<string, string> = {
        education: "textEducation",
        children: "textChildren",
        housing: "textHousing",
      };
      return {
        text: text(`deduction.${variants[str("kind")] ?? "text"}`, {
          amount: bynOf(params["amount"]),
        }),
        show: onObject,
      };
    }
    case "insurance-renewal": {
      const variants: Record<string, string> = { osago: "textOsago", kasko: "textKasko" };
      return {
        text: text(`insurance-renewal.${variants[str("kind")] ?? "text"}`, {
          paidOn: str("paidOn"),
          remindOn: str("remindOn"),
        }),
        show: onObject,
      };
    }
    case "calendar-reminder": {
      const base = "calendar-reminder";
      const days = num("days");
      const when =
        days <= 0
          ? text(`${base}.when.today`)
          : days === 1
            ? text(`${base}.when.tomorrow`)
            : text(`${base}.when.days`, { count: days });
      const type = str("type") === "" ? "own" : str("type");
      const title = str("title");
      const rule = str("rule");
      const ruleName =
        rule === ""
          ? ""
          : t(`notifications:kinds.${base}.rules.${rule}` as never, { defaultValue: "" } as never);
      const values = { when, title, type: text(`${base}.types.${type}`), rule: ruleName };
      const key =
        type === "warranty" && title !== ""
          ? "textWarranty"
          : rule !== "" && ruleName !== ""
            ? "textRule"
            : title !== ""
              ? "textEvent"
              : "textType";
      return { text: text(`${base}.${key}`, values), show: onObject };
    }
    case "receipt-match":
      return {
        text:
          notification.undoToken !== null
            ? text("receipt-match.textLinked", {
                store: str("store"),
                date: str("date"),
                bankDate: str("bankDate"),
              })
            : text("receipt-match.text", {
                store: str("store"),
                date: str("date"),
                bankDate: str("bankDate"),
              }),
        show: onObject,
      };
    default:
      return { text: text(`${notification.kind}.text`), show: onObject };
  }
}
