// ROLE-01, ARCHITECTURE §6.4: Scope («чьи это данные») рождается только на входах через makeScope; собрать его
// литералом нельзя — это проверяет компилятор.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { HouseholdId, UserId } from "./ids.ts";
import { makeScope, type Scope } from "./scope.ts";

const userId = UserId.parse("0190f0a0-0000-7000-8000-000000000001");
const householdId = HouseholdId.parse("0190f0a0-0000-7000-8000-000000000002");

describe("Scope", () => {
  it("makeScope собирает Scope из пользователя и домохозяйства", () => {
    expect(makeScope({ userId, householdId })).toEqual({ userId, householdId });
  });

  it("Scope неизменяем", () => {
    const scope = makeScope({ userId, householdId });
    expect(Object.isFrozen(scope)).toBe(true);
  });

  it("строка вместо id — ошибка уже во время выполнения", () => {
    const input = { userId: "не-uuid", householdId } as unknown as Parameters<typeof makeScope>[0];
    expect(() => makeScope(input)).toThrow(z.ZodError);
  });

  it("литерал с теми же полями — не Scope: компилятор требует makeScope", () => {
    // @ts-expect-error — у литерала нет бренда Scope: «чьи данные» нельзя собрать в обход входа (ARCHITECTURE §6.4)
    const forged: Scope = { userId, householdId };
    expect(forged).toEqual(makeScope({ userId, householdId }));
  });

  it("id пользователя и домохозяйства не перепутать: у них разные бренды", () => {
    // @ts-expect-error — UserId на месте HouseholdId не компилируется: бренды id различаются
    const swapped = makeScope({ userId, householdId: userId });
    expect(swapped.householdId).toBe(userId);
  });
});
