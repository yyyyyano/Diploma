// Таблицы legal-consult (LEGAL-12, ARCHITECTURE §6.1) — userOwnedTable. Состояние чек-листа: строка на каждую отмеченную галочку
// (чек-лист, к чему относится, пункт). «Отметить» — вставка, «снять» — удаление: два одновременных нажатия не теряют друг друга, блокировок
// нет. К чему относится — `general` (сам по себе), `message:<id>` (в сообщении чата) или `deduction:<id>` (у найденного вычета): таблиц чата
// и вычетов ещё нет, поэтому без внешнего ключа — строка живёт вместе с домохозяйством и уходит с его данными.
import { sql } from "drizzle-orm";
import { check, text, uniqueIndex } from "drizzle-orm/pg-core";
import { userOwnedTable } from "../../../../platform/db/tables.ts";

export const checklistProgress = userOwnedTable(
  "checklist_progress",
  {
    checklistId: text().notNull(),
    subject: text().notNull(),
    itemId: text().notNull(),
  },
  (t) => [
    check(
      "checklist_progress_ids_check",
      sql`${t.checklistId} ~ '^[a-z][a-z0-9-]{0,40}$' and ${t.itemId} ~ '^[a-z][a-z0-9-]{0,40}$'`,
    ),
    check(
      "checklist_progress_subject_check",
      sql`${t.subject} ~ '^(general|(message|deduction):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$'`,
    ),
    uniqueIndex("checklist_progress_item_idx").on(
      t.householdId,
      t.checklistId,
      t.subject,
      t.itemId,
    ),
  ],
);
