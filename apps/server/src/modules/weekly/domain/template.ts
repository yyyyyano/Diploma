// Текст итогов недели без модели (WEEK-02): те же числа, что видит человек, складываются по шаблону словаря `weekly`. Им же заменяется
// ответ модели, если модели нет (нет согласия на облако, локальная не скачана) или в её тексте нашлось число вне готовых.
import { formatMoney } from "@kosht/i18n";
import type { WeeklyT } from "@kosht/i18n";
import type { WeeklySummary } from "@kosht/contract";

/** Числа и подписи сводки без текста — вход шаблона и документ для модели. */
export type WeeklyFacts = Omit<WeeklySummary, "id" | "text" | "textSource" | "createdAt">;

/** На сколько дней вперёд смотрят платежи и события («на этой неделе»). */
export const UPCOMING_DAYS = 7;

/** «такси и кафе»: список названий через запятую, последнее — через «и». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} и ${names.at(-1) ?? ""}`;
}

/** Шаблон: предложения идут по порядку примера WEEK-01, отсутствующие числа пропускаются, а не заменяются нулём. */
export function templateText(facts: WeeklyFacts, t: WeeklyT): string {
  const sentences: string[] = [];
  if (facts.spent.amount.minor === 0) {
    sentences.push(t("template.spentNone"));
  } else {
    const lead = t("template.spent", { amount: formatMoney(facts.spent.amount) });
    const percent = facts.deviation?.percent;
    const comparison =
      percent === undefined
        ? ""
        : percent > 0
          ? t("template.more", { percent })
          : percent < 0
            ? t("template.less", { percent: -percent })
            : t("template.same");
    sentences.push(`${lead}${comparison}`);
    const [first] = facts.categories;
    if (first !== undefined) sentences.push(t("template.topOne", { name: first.name }));
  }
  for (const limit of facts.limits) {
    sentences.push(t("template.limit", { name: limit.name, percent: limit.percent }));
  }
  const { payments } = facts.upcoming;
  if (payments !== null) {
    const names = facts.upcoming.items.flatMap((item) => (item.title === null ? [] : [item.title]));
    sentences.push(
      names.length === 0
        ? t("template.upcoming", { days: UPCOMING_DAYS, amount: formatMoney(payments.amount) })
        : t("template.upcomingNamed", {
            days: UPCOMING_DAYS,
            names: joinNames(names.slice(0, 3)),
            amount: formatMoney(payments.amount),
          }),
    );
  }
  if (facts.foundDeductions > 0) {
    sentences.push(t("template.found", { count: facts.foundDeductions }));
  }
  return `${sentences.join(". ")}.`;
}
