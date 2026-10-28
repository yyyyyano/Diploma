// Таблицы profile (PROF-01…06, AUTH-07, ARCHITECTURE §6.1) — userOwnedTable. Факт: ключ, значение (jsonb по схеме
// контракта), источник, статус, день записи; ключ PROF-01 — один на пользователя (частичный уникальный индекс, у
// заметок ключ не уникален). Удалённый факт не стирается сразу, а помечается (deleted_at): так «Отменить» его
// возвращает; фасад и страница его не видят. Ревизия — состояние факта до действия: по ней «Отменить» восстанавливает
// прежнее значение, а в журнале действий лежит только id ревизии. Профиль — признак «анкета пройдена или пропущена».
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ownedFk, userOwnedTable } from "../../../../platform/db/tables.ts";

export const profileFacts = userOwnedTable(
  "profile_facts",
  {
    key: text().notNull(),
    topic: text().notNull(),
    value: jsonb().notNull(),
    source: text().notNull(),
    sourceRef: text(),
    status: text().notNull(),
    recordedOn: date({ mode: "string" }).notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check(
      "profile_facts_source_check",
      sql`${t.source} in ('questionnaire', 'chat', 'statements', 'system', 'user')`,
    ),
    check("profile_facts_status_check", sql`${t.status} in ('confirmed', 'assumed')`),
    uniqueIndex("profile_facts_key_idx")
      .on(t.householdId, t.userId, t.key)
      .where(sql`${t.key} <> 'note'`),
  ],
);

export const profileFactRevisions = userOwnedTable(
  "profile_fact_revisions",
  {
    factId: uuid().notNull(),
    /** Факта до действия не было: «Отменить» убирает его. */
    existed: boolean().notNull(),
    value: jsonb().notNull(),
    source: text().notNull(),
    sourceRef: text(),
    status: text().notNull(),
    recordedOn: date({ mode: "string" }).notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  },
  (t) => [...ownedFk(t, t.factId, profileFacts, { onDelete: "cascade" })],
);

export const profiles = userOwnedTable(
  "profiles",
  {
    /** AUTH-07: анкету прошли или пропустили — больше не показывается. */
    onboardingDoneAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex("profiles_user_idx").on(t.householdId, t.userId)],
);
