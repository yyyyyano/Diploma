// Фабрики примитивов для тестов: деньги, дни, id и Scope. Без случайности — один и тот же тест даёт одни и те же
// данные; id — валидные uuidv7 по номеру, у каждого бренда своя метка, чтобы id разных видов не совпадали.
import {
  HouseholdId,
  LocalDate,
  makeScope,
  Money,
  type Scope,
  TraceId,
  UserId,
} from "@kosht/kernel";

/** Деньги BYN в копейках: `byn(84_000)` — 840,00 BYN. */
export function byn(minor: number): Money {
  return Money.of(minor, "BYN");
}

/** Календарный день: `day("2026-10-21")`. */
export function day(text: string): LocalDate {
  return LocalDate.parse(text);
}

/** uuidv7 вида `00000000-0000-7000-8<метка>00-<номер в hex>`: версия 7, вариант RFC 9562. */
function testUuid(label: 1 | 2 | 3, n: number): string {
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new RangeError(`Номер тестового id — целое от 1, получено ${n}.`);
  }
  return `00000000-0000-7000-8${label}00-${n.toString(16).padStart(12, "0")}`;
}

export function testUserId(n = 1): UserId {
  return UserId.parse(testUuid(1, n));
}

export function testHouseholdId(n = 1): HouseholdId {
  return HouseholdId.parse(testUuid(2, n));
}

export function testTraceId(n = 1): TraceId {
  return TraceId.parse(testUuid(3, n));
}

/** Scope пользователя `user` в домохозяйстве `household` (тестам makeScope разрешён, ARCHITECTURE §6.4). */
export function testScope(options: { user?: number; household?: number } = {}): Scope {
  return makeScope({
    userId: testUserId(options.user ?? 1),
    householdId: testHouseholdId(options.household ?? 1),
  });
}
