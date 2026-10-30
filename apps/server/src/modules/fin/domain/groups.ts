// FIN-20: группы обязательных платежей разбивки свободного остатка — по разделу и категории регулярного платежа (REC-04).
// Чистое правило без БД: ЖКХ, аренда, связь, кредиты, подписки и «прочие обязательные» (тип, выбранный человеком, без этих категорий).
import type { ObligationGroup } from "@kosht/contract";

/** Порядок слагаемых в разбивке: «ЖКХ − связь − кредит − подписки». */
export const GROUP_ORDER: readonly ObligationGroup[] = [
  "utilities",
  "rent",
  "communication",
  "loan",
  "subscriptions",
  "other",
];

/** Ключ трассы слагаемого (TRACE_KEYS): `fin.obligation.<группа>`. */
export const GROUP_TRACE_KEY: Readonly<Record<ObligationGroup, string>> = {
  utilities: "fin.obligation.utilities",
  rent: "fin.obligation.rent",
  communication: "fin.obligation.communication",
  loan: "fin.obligation.loan",
  subscriptions: "fin.obligation.subscriptions",
  other: "fin.obligation.other",
};

/** Группа обязательного платежа: подписки — свой раздел, остальные — по категории (иначе «прочие»). */
export function groupOf(section: string, categoryCode: string | null): ObligationGroup {
  if (section === "subscriptions") return "subscriptions";
  switch (categoryCode) {
    case "utilities":
      return "utilities";
    case "rent":
      return "rent";
    case "telecom":
      return "communication";
    case "loans":
      return "loan";
    default:
      return "other";
  }
}
