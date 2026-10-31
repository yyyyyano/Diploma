// Состояние чек-листов (LEGAL-12): отмеченные пункты домохозяйства. Первый аргумент — s: ScopedDb, у каждого обращения свой s.own (ADR-0006).
// Строка на галочку: «отметить» — вставка (повтор молча пропускается уникальным индексом), «снять» — удаление: параллельные нажатия не теряются.
import { and, eq, sql } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { checklistProgress } from "./schema.ts";

/** Отмеченные пункты чек-листа для этого `subject` (`general`, `message:<id>`, `deduction:<id>`). */
export async function checkedItems(
  s: ScopedDb,
  checklistId: string,
  subject: string,
): Promise<string[]> {
  const rows = await s.db
    .select({ itemId: checklistProgress.itemId })
    .from(checklistProgress)
    .where(
      and(
        s.own(checklistProgress),
        eq(checklistProgress.checklistId, checklistId),
        eq(checklistProgress.subject, subject),
      ),
    );
  return rows.map((r) => r.itemId);
}

export async function setChecked(
  s: ScopedDb,
  input: { checklistId: string; subject: string; itemId: string; done: boolean },
): Promise<void> {
  const { checklistId, subject, itemId } = input;
  if (input.done) {
    await s
      .insert(checklistProgress)
      .values({ checklistId, subject, itemId })
      .onConflictDoNothing();
    return;
  }
  await s.delete(
    checklistProgress,
    sql`${checklistProgress.checklistId} = ${checklistId} and ${checklistProgress.subject} = ${subject} and ${checklistProgress.itemId} = ${itemId}`,
  );
}
