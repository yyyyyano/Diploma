// Части сохранённого ответа (CHAT-04, CHAT-10): что из них годится для показа и какие версии статей в них названы.
// Чистые правила: БД и соседей здесь нет.
import { LawAnswerData, UiMessagePart } from "@kosht/contract";

/**
 * Части, прошедшие строгую схему реестра. Испорченная данные-часть (схема изменилась, запись повреждена) отбрасывается и
 * считается — чтение диалога не должно падать из-за одной карточки; сколько отброшено, сценарий пишет в лог.
 */
export function validParts(parts: unknown): { parts: unknown[]; dropped: number } {
  if (!Array.isArray(parts)) return { parts: [], dropped: 0 };
  const kept = parts.filter((part: unknown) => UiMessagePart.safeParse(part).success);
  return { parts: kept, dropped: parts.length - kept.length };
}

/** Версии фрагментов, на которые сослался правовой ответ (`data-law-answer`), без повторов — для «статья изменилась» (CHAT-10). */
export function lawVersionIdsOf(parts: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const part of parts) {
    if (typeof part !== "object" || part === null || !("type" in part)) continue;
    if (part.type !== "data-law-answer" || !("data" in part)) continue;
    const answer = LawAnswerData.safeParse(part.data);
    if (!answer.success) continue;
    for (const id of answer.data.versionIds) ids.add(id);
  }
  return [...ids];
}
