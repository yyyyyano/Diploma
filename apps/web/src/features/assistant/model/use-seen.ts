// Что «видит» ассистент (CHAT-08): страница, с которой его открыли, и её период — для подписи «Вижу: Главная ·
// Октябрь 2026» и для контекста вопроса. На самой странице чата (`/assistant`, телефон — полноэкранный маршрут)
// берётся последняя страница, не являющаяся чатом: контекст «Ассистент» ничего не говорит о деньгах.
import type { PageContext } from "@kosht/contract";
import { formatDate, resources } from "@kosht/i18n";
import { useEffect, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { assistantBridge } from "../../../lib/assistant-bridge.ts";
import { usePageInfo, type PageInfo } from "../../../lib/page-context.ts";
import { navKeyOf, seenPeriod } from "./seen.ts";

const MONTHS = resources.ru.dashboard.period.months;
type Month = keyof typeof MONTHS;

export interface Seen {
  /** «Главная · Октябрь 2026» — без слова «Вижу». */
  readonly label: string;
  /** Контекст для вопроса: у чата — последняя страница. */
  readonly context: PageContext;
}

/**
 * Запоминает страницу, пока человек не в чате: чат (на телефоне — уже другая страница) откроет её контекст. Без текстов:
 * живёт в каркасе, то есть в первой загрузке сайта.
 */
export function useRememberPage(): PageInfo {
  const current = usePageInfo();
  const onChat = current.page === "assistant";
  useEffect(() => {
    if (!onChat) assistantBridge.rememberPage(current);
  }, [onChat, current]);
  return current;
}

export function useSeen(): Seen {
  const { t } = useTranslation(["assistant", "shell", "dashboard"]);
  const current = useRememberPage();
  const remembered = useSyncExternalStore(
    assistantBridge.subscribe,
    () => assistantBridge.getState().lastPage,
  );
  const onChat = current.page === "assistant";

  const effective: PageInfo = onChat && remembered !== undefined ? remembered : current;
  const nav = navKeyOf(effective.page);
  const name = nav === undefined ? t("panel.seesPage") : t(`shell:nav.${nav}`);
  const period = seenPeriod(effective.context.params);
  let periodText: string | undefined;
  if (period?.kind === "month" && Object.hasOwn(MONTHS, period.month)) {
    periodText = t("context.period", {
      month: t(`dashboard:period.months.${period.month as Month}`),
      year: period.year,
    });
  } else if (period?.kind === "range") {
    periodText = t("context.range", { from: formatDate(period.from), to: formatDate(period.to) });
  }
  return {
    label: periodText === undefined ? name : `${name} · ${periodText}`,
    context: effective.context,
  };
}
