// AUTH-11, SEC-04: бот перед каждым сообщением спрашивает у identity, активен ли владелец привязки: заблокированному —
// понятный отказ, исчезнувшему (или из другого домохозяйства) — как отвязанному.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemDb } from "../../../platform/db/system-db.ts";
import { memberState } from "../infrastructure/db/identity.repo.ts";
import { identityPlatform, seedUser } from "./__fixtures__/identity-platform.ts";
import { makeAdminGuard } from "./admins.ts";

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
});
afterAll(async () => {
  await db.drop();
});

describe("AUTH-11: состояние пользователя для бота", () => {
  it("активный — active; заблокированный — blocked; чужое домохозяйство и неизвестный — absent", async () => {
    const system = createSystemDb(db.pool);
    await seedUser(db, {
      email: "admin@example.test",
      password: "пароль-админа-2026",
      role: "admin",
    });
    const user = await seedUser(db, {
      email: "u@example.test",
      password: "пароль-пользователя-2026",
    });
    const other = await seedUser(db, { email: "o@example.test", password: "пароль-другого-2026" });
    expect(await memberState(system, user)).toBe("active");

    await makeAdminGuard(identityPlatform(db).platform).setStatus(user.userId, "blocked");
    expect(await memberState(system, user)).toBe("blocked");

    expect(await memberState(system, { userId: user.userId, householdId: other.householdId })).toBe(
      "absent",
    );
    expect(await memberState(system, { userId: other.userId, householdId: user.householdId })).toBe(
      "absent",
    );
  });
});
