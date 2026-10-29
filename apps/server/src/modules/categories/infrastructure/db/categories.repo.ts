// Свои категории, скрытые встроенные и правила пользователя: первый аргумент — s: ScopedDb, у каждого обращения свой
// s.own (ADR-0006).
import { and, asc, eq } from "drizzle-orm";
import type { ScopedDb } from "../../../../platform/db/scoped-db.ts";
import { categories, categoryRules, hiddenSystemCategories } from "./schema.ts";

export interface CustomRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly icon: string;
  readonly color: string;
  readonly hidden: boolean;
}

const customColumns = {
  id: categories.id,
  name: categories.name,
  kind: categories.kind,
  icon: categories.icon,
  color: categories.color,
  hidden: categories.hidden,
};

export async function listCustom(s: ScopedDb): Promise<CustomRow[]> {
  return s.db
    .select(customColumns)
    .from(categories)
    .where(s.own(categories))
    .orderBy(asc(categories.createdAt), asc(categories.id));
}

export async function findCustom(s: ScopedDb, id: string): Promise<CustomRow | undefined> {
  const rows = await s.db
    .select(customColumns)
    .from(categories)
    .where(and(s.own(categories), eq(categories.id, id)));
  return rows[0];
}

/** Своя категория; такое же название того же типа уже есть — undefined. */
export async function insertCustom(
  s: ScopedDb,
  row: Omit<CustomRow, "id" | "hidden">,
): Promise<string | undefined> {
  const rows = await s
    .insert(categories)
    .values(row)
    .onConflictDoNothing()
    .returning({ id: categories.id });
  return rows[0]?.id;
}

/** Обновить свою категорию; нет такой — false. Совпадение названия — ошибка уникальности базы (её ловит сценарий). */
export async function updateCustom(
  s: ScopedDb,
  id: string,
  patch: { name?: string; hidden?: boolean },
  at: Date,
): Promise<boolean> {
  const rows = await s
    .update(categories, eq(categories.id, id))
    .set({ ...patch, updatedAt: at })
    .returning({ id: categories.id });
  return rows.length > 0;
}

export async function hiddenCodes(s: ScopedDb): Promise<Set<string>> {
  const rows = await s.db
    .select({ code: hiddenSystemCategories.code })
    .from(hiddenSystemCategories)
    .where(s.own(hiddenSystemCategories));
  return new Set(rows.map((row) => row.code));
}

/** CAT-02: скрыть встроенную — строка настроек домохозяйства; показать — удалить её. Повтор ничего не меняет. */
export async function setSystemHidden(s: ScopedDb, code: string, hidden: boolean): Promise<void> {
  if (hidden) {
    await s.insert(hiddenSystemCategories).values({ code }).onConflictDoNothing();
  } else {
    await s.delete(hiddenSystemCategories, eq(hiddenSystemCategories.code, code));
  }
}

export interface UserRule {
  readonly matcher: "merchant" | "item";
  readonly pattern: string;
  readonly systemCode: string | null;
  readonly categoryId: string | null;
}

export async function listUserRules(s: ScopedDb): Promise<UserRule[]> {
  const rows = await s.db
    .select({
      matcher: categoryRules.matcher,
      pattern: categoryRules.pattern,
      systemCode: categoryRules.systemCode,
      categoryId: categoryRules.categoryId,
    })
    .from(categoryRules)
    .where(s.own(categoryRules));
  return rows.map((row) => ({ ...row, matcher: row.matcher as UserRule["matcher"] }));
}

/** CAT-05: правило пользователя по шаблону — для «Отменить» (вернуть прежнее) и для вопроса «применить к прошлым». */
export async function findUserRule(
  s: ScopedDb,
  matcher: UserRule["matcher"],
  pattern: string,
): Promise<UserRule | undefined> {
  const rows = await s.db
    .select({
      pattern: categoryRules.pattern,
      systemCode: categoryRules.systemCode,
      categoryId: categoryRules.categoryId,
    })
    .from(categoryRules)
    .where(
      and(
        s.own(categoryRules),
        eq(categoryRules.matcher, matcher),
        eq(categoryRules.pattern, pattern),
      ),
    );
  const row = rows[0];
  return row === undefined ? undefined : { ...row, matcher };
}

/** CAT-05: удалить правило пользователя по шаблону («Отменить» правила, которого раньше не было). */
export async function deleteUserRule(
  s: ScopedDb,
  matcher: UserRule["matcher"],
  pattern: string,
): Promise<void> {
  await s.delete(
    categoryRules,
    and(eq(categoryRules.matcher, matcher), eq(categoryRules.pattern, pattern)) ??
      eq(categoryRules.matcher, matcher),
  );
}

/** CAT-05: правило пользователя для контрагента или позиции — новое или заменяет прежнее с тем же шаблоном. */
export async function upsertUserRule(s: ScopedDb, rule: UserRule, at: Date): Promise<void> {
  await s
    .insert(categoryRules)
    .values(rule)
    .onConflictDoUpdate({
      target: [categoryRules.householdId, categoryRules.matcher, categoryRules.pattern],
      set: { systemCode: rule.systemCode, categoryId: rule.categoryId, updatedAt: at },
    });
}
