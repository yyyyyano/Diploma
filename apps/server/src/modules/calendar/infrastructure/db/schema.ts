// Таблицы calendar (CAL-01…07, ARCHITECTURE §6.1) — userOwnedTable. Хранятся только события, у которых есть напоминания: свои
// (CAL-06), гарантии (CAL-04), сроки налогов (CAL-02) и страховки (CAL-05); даты регулярных платежей и кредитов читаются из
// `recurring` при запросе и сюда не копируются (REC-03). `key` — ключ идемпотентности автоматического события
// (`warranty:<позиция чека>`, `rule:<правило>:<год>`): повторное событие или пересчёт дубль не создаёт; у событий человека
// ключа нет. Напоминание — строка `calendar_reminders` на «событие + за сколько дней»: тик раз в минуту отправляет те, чей
// срок наступил и которые не отправлены (пропуск при выключенном компьютере догоняется сам, NFR-22). Деньги — целые копейки.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ownedFk, userOwnedTable } from "../../../../platform/db/tables.ts";

export const STORED_TYPES = ["own", "tax", "insurance", "credit", "warranty"] as const;
export const ORIGINS = ["user", "chat", "warranty", "rule", "insurance"] as const;
export const REMINDER_STATUSES = ["pending", "sent", "skipped"] as const;

export type EventParams = Record<string, string | number>;

export const calendarEvents = userOwnedTable(
  "calendar_events",
  {
    type: text().notNull(),
    /** Название от человека или позиции чека; у событий по правилу — null (название — по `rule` в словаре сайта). */
    title: text(),
    /** Ключ правила срока налога или страховки (`calendar/domain/deadline-rules.ts`); у прочих — null. */
    rule: text(),
    /** День события; null — правило без даты (норма не называет даты, CAL-02): день укажет человек. */
    day: date({ mode: "string" }),
    amountMinor: bigint({ mode: "number" }),
    currency: text().notNull().default("BYN"),
    origin: text().notNull(),
    /** Параметры источника для подписи «Откуда это событие»: магазин, день покупки, срок гарантии… */
    params: jsonb()
      .$type<EventParams>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** Связанный объект: `receipt:<id>`, `transaction:<id>`; нет — null. */
    refEntity: text(),
    refId: uuid(),
    /** Ключ идемпотентности автоматического события; у событий человека — null. */
    key: text(),
    /** За сколько дней напомнить (CAL-07): подмножество 0, 1, 7, 30. */
    remindDays: integer()
      .array()
      .notNull()
      .default(sql`'{}'::integer[]`),
    /** День правил пересчёт не трогает, если человек его менял сам. */
    onEdited: boolean().notNull().default(false),
  },
  (t) => [
    check(
      "calendar_events_type_check",
      sql`${t.type} in ('own', 'tax', 'insurance', 'credit', 'warranty')`,
    ),
    check(
      "calendar_events_origin_check",
      sql`${t.origin} in ('user', 'chat', 'warranty', 'rule', 'insurance')`,
    ),
    check("calendar_events_amount_check", sql`${t.amountMinor} is null or ${t.amountMinor} >= 0`),
    // У события без правила день обязателен: «без даты» бывает только у правила срока.
    check("calendar_events_day_check", sql`${t.day} is not null or ${t.rule} is not null`),
    uniqueIndex("calendar_events_key_idx").on(t.householdId, t.userId, t.key),
    index("calendar_events_day_idx").on(t.householdId, t.userId, t.day),
  ],
);

export const calendarReminders = userOwnedTable(
  "calendar_reminders",
  {
    eventId: uuid().notNull(),
    offsetDays: integer().notNull(),
    /** Когда отправить: день события минус offset, в настроенное время суток по поясу системы. */
    dueAt: timestamp({ withTimezone: true }).notNull(),
    status: text().notNull().default("pending"),
    sentAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check("calendar_reminders_status_check", sql`${t.status} in ('pending', 'sent', 'skipped')`),
    check("calendar_reminders_offset_check", sql`${t.offsetDays} >= 0`),
    uniqueIndex("calendar_reminders_event_idx").on(t.householdId, t.eventId, t.offsetDays),
    index("calendar_reminders_due_idx").on(t.status, t.dueAt),
    ...ownedFk(t, t.eventId, calendarEvents, { onDelete: "cascade" }),
  ],
);
