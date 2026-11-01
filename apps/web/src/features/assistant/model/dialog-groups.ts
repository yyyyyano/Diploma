// Группы списка диалогов (design: «Сегодня», «Вчера», «Ранее»): день последнего сообщения по поясу системы (NFR-23).
import type { ConversationItem } from "@kosht/contract";
import { DEFAULT_TIME_ZONE, LocalDate } from "@kosht/kernel";

export type DialogGroupKey = "today" | "yesterday" | "earlier";

export interface DialogGroup {
  readonly key: DialogGroupKey;
  readonly items: readonly ConversationItem[];
}

const dayOf = (iso: string): LocalDate => LocalDate.fromInstant(new Date(iso), DEFAULT_TIME_ZONE);

export function groupKeyOf(updatedAt: string, today: LocalDate): DialogGroupKey {
  const day = dayOf(updatedAt);
  if (day === today) return "today";
  return day === LocalDate.addDays(today, -1) ? "yesterday" : "earlier";
}

/** Порядок элементов сохраняется (сервер отдаёт свежие сверху); пустые группы не возвращаются. */
export function groupDialogs(
  items: readonly ConversationItem[],
  today: LocalDate = LocalDate.fromInstant(new Date(), DEFAULT_TIME_ZONE),
): DialogGroup[] {
  const groups: DialogGroup[] = [];
  for (const key of ["today", "yesterday", "earlier"] as const) {
    const inGroup = items.filter((item) => groupKeyOf(item.updatedAt, today) === key);
    if (inGroup.length > 0) groups.push({ key, items: inGroup });
  }
  return groups;
}
