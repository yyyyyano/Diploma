// NOTIF-03 сквозь HTTP и корень композиции: уведомления администраторов видит только роль admin (обычный
// пользователь — FORBIDDEN), лента пользователя — своя; фасад notifications доступен соседям из корня композиции.
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { NotificationsFacade } from "../modules/notifications/index.ts";
import { sessionCookie, startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db);
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

function notifications(): NotificationsFacade {
  const module = stack.api.modules.find((m) => m.id === "notifications");
  if (module === undefined) throw new Error("нет модуля notifications");
  return module.facade as NotificationsFacade;
}

describe("NOTIF-03: роли", () => {
  it("администратор видит уведомление администраторов, пользователь — FORBIDDEN и своя пустая лента", async () => {
    const admin = { email: "admin@example.test", password: "пароль-администратора" };
    await stack.call("local", "/identity/setup", { body: admin });
    const adminCookie = sessionCookie(
      await stack.call("local", "/identity/sign-in", { body: admin }),
    );
    const userCookie = sessionCookie(
      await stack.call("local", "/identity/register", {
        body: {
          email: "user@example.test",
          password: "пароль-пользователя",
          consents: {
            personalData: { accepted: true, version: "2026-10-26" },
            cloud: { accepted: false, version: "2026-10-26" },
          },
        },
      }),
    );
    await notifications().notifyAdmins({ kind: "ai-provider", key: "groq:429:2026-10-26" });

    const forAdmin = await stack.call("local", "/notifications/admin", { cookie: adminCookie });
    expect(forAdmin.status).toBe(200);
    expect(await forAdmin.json()).toMatchObject({
      items: [{ kind: "ai-provider", read: false }],
      unread: 1,
    });

    const forUser = await stack.call("local", "/notifications/admin", { cookie: userCookie });
    expect(forUser.status).toBe(403);
    expect(await forUser.json()).toMatchObject({ code: "FORBIDDEN" });
    // GET с размером страницы в строке запроса, как шлёт сайт: «20» приводится к числу.
    const page = await stack.call("local", "/notifications?limit=20", { cookie: userCookie });
    expect(page.status).toBe(200);
    expect(
      await (await stack.call("local", "/notifications", { cookie: userCookie })).json(),
    ).toEqual({
      items: [],
      nextCursor: null,
      unread: 0,
    });
  });
});
