// Тексты быстрых команд (TG-07): `/balance`, `/limits`, `/week` — числа приходят готовыми от сервера (P1), здесь только слова и
// формат; текст — через t() (NFR-19). Коротко: бот не пересказывает сайт, а ссылается на него (TG-08).
import type { BudgetLimit, DashboardOverview, WeeklySummary } from "@kosht/contract";
import { formatDate, formatMoney, type TelegramT } from "@kosht/i18n";

/** Сколько счетов показывает `/balance`, остальные — «…и ещё N». */
export const BALANCE_ACCOUNTS = 8;

function accountLabel(
  t: TelegramT,
  account: DashboardOverview["accounts"]["items"][number],
): string {
  const name = account.name ?? account.bank ?? t("bot.balance.account");
  return account.mask === null ? name : `${name} •• ${account.mask}`;
}

/** `/balance`: остатки по счетам и свободный остаток. */
export function balanceText(t: TelegramT, overview: DashboardOverview): string {
  const { items, total } = overview.accounts;
  if (items.length === 0) return t("bot.balance.noAccounts");
  const rows: string[] = [];
  if (total !== null) rows.push(t("bot.balance.total", { amount: formatMoney(total.amount) }));
  for (const account of items.slice(0, BALANCE_ACCOUNTS)) {
    rows.push(`• ${accountLabel(t, account)} — ${formatMoney(account.balance)}`);
  }
  if (items.length > BALANCE_ACCOUNTS) {
    rows.push(t("bot.balance.more", { count: items.length - BALANCE_ACCOUNTS }));
  }
  const { freeBalance } = overview;
  rows.push(
    freeBalance.amount === null
      ? t("bot.balance.freeUnknown")
      : t("bot.balance.free", {
          amount: formatMoney(freeBalance.amount),
          months: freeBalance.months,
        }),
  );
  return rows.join("\n");
}

/** `/limits`: по строке на лимит месяца; названия категорий — из справочника (`categoryName`). */
export function limitsText(
  t: TelegramT,
  limits: readonly BudgetLimit[],
  daysLeft: number,
  categoryName: (categoryKey: string) => string,
): string {
  if (limits.length === 0) return t("bot.limits.empty");
  return [
    t("bot.limits.title", { days: daysLeft }),
    ...limits.map((limit) =>
      t("bot.limits.line", {
        category: categoryName(limit.categoryKey),
        percent: limit.percent,
        spent: formatMoney(limit.spent),
        limit: formatMoney(limit.limit),
      }),
    ),
  ].join("\n");
}

/** `/week` и уведомление «Итоги недели»: заголовок с неделей и текст сводки (его уже проверил `weekly`: числа — из расчёта). */
export function weekText(t: TelegramT, summary: WeeklySummary): string {
  const title = t("bot.week.title", {
    from: formatDate(summary.weekStart),
    to: formatDate(summary.weekEnd),
  });
  return `${title}\n${summary.text}`;
}
