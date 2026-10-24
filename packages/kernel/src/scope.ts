// «Чьи это данные» (ROLE-01, SEC-04, ADR-0006). Scope рождается только на входах — сессия сайта, Telegram,
// конверт задачи, запуск агента, тесты (ARCHITECTURE §6.4) — и никогда из тела запроса или аргументов модели.
// Бренд не даёт собрать Scope литералом: единственный способ — makeScope (места вызова проверяет isolation.mjs).
import { z } from "zod";
import { HouseholdId, UserId } from "./ids.ts";

const schema = z.object({ userId: UserId, householdId: HouseholdId }).readonly().brand<"Scope">();

/** Пользователь и его домохозяйство; неизменяем. */
export type Scope = z.infer<typeof schema>;

/** Scope из уже проверенных id входа (сессии, привязки Telegram, конверта задачи); неверный id — `ZodError`. */
export function makeScope(input: { userId: UserId; householdId: HouseholdId }): Scope {
  return schema.parse(input);
}
