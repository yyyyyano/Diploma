// «Вижу: Главная · Октябрь 2026» (CHAT-08): что ассистент знает о странице, на которой его открыли. Период берётся из
// параметров адреса: `period=2026-09` (админка), `from`/`to` (главная, операции) — целый календарный месяц называется
// словами, остальное — диапазоном дат; страницы без периода называются только по имени.
import type { resources } from "@kosht/i18n";
import { LocalDate } from "@kosht/kernel";

export type NavKey = keyof (typeof resources)["ru"]["shell"]["nav"];

const NAV_KEYS = new Set<string>([
  "dashboard",
  "assistant",
  "operations",
  "documents",
  "accounts",
  "recurring",
  "budget",
  "calendar",
  "deductions",
  "afford",
  "laws",
  "memory",
  "settings",
  "admin",
]);

/** Раздел меню по id страницы (`staticData.page`): «admin-users» — «admin»; неизвестный — undefined. */
export function navKeyOf(page: string | undefined): NavKey | undefined {
  if (page === undefined) return undefined;
  const key = page.startsWith("admin-") ? "admin" : page;
  return NAV_KEYS.has(key) ? (key as NavKey) : undefined;
}

export type SeenPeriod =
  | { readonly kind: "month"; readonly month: string; readonly year: string }
  | { readonly kind: "range"; readonly from: LocalDate; readonly to: LocalDate };

const MONTH = /^(\d{4})-(\d{2})$/u;

/** Первое число следующего месяца минус день — последний день месяца. */
function monthEnd(day: LocalDate): LocalDate {
  const [year = 0, month = 0] = day.split("-").map(Number);
  const next =
    month === 12
      ? `${String(year + 1)}-01-01`
      : `${String(year)}-${String(month + 1).padStart(2, "0")}-01`;
  return LocalDate.addDays(LocalDate.parse(next), -1);
}

export function seenPeriod(params: Readonly<Record<string, string>>): SeenPeriod | undefined {
  const month = MONTH.exec(params["period"] ?? "");
  if (month?.[1] !== undefined && month[2] !== undefined) {
    return { kind: "month", month: month[2], year: month[1] };
  }
  const from = LocalDate.schema.safeParse(params["from"]);
  const to = LocalDate.schema.safeParse(params["to"]);
  if (!from.success && !to.success) return undefined;
  if (from.success && to.success) {
    const first = from.data.slice(0, 7) === to.data.slice(0, 7);
    // Целый календарный месяц — «Октябрь 2026», а не «01.10.2026 – 31.10.2026».
    if (first && from.data.endsWith("-01") && to.data === monthEnd(from.data)) {
      return { kind: "month", month: from.data.slice(5, 7), year: from.data.slice(0, 4) };
    }
    return { kind: "range", from: from.data, to: to.data };
  }
  const only = from.success ? from.data : to.success ? to.data : undefined;
  return only === undefined ? undefined : { kind: "range", from: only, to: only };
}
