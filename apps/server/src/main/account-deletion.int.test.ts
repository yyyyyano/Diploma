// PRIV-06, AUTH-12, КП PRIV сквозь HTTP и корень композиции: «Удалить аккаунт» с паролем удаляет данные пользователя
// во всех userOwnedTable (тест полноты: перед удалением в каждой таблице реестра есть его строка, после — ни одной),
// файлы, системные строки (сессии, ссылки из писем, письма ящика, режим privacy, «прочитано» администратора),
// ожидающие задачи домохозяйства и запись identity; трассы Langfuse (выключен в тестах) — в очереди повторов llm.
// Данные другого домохозяйства не меняются. Неверный пароль и последний администратор — отказ без удаления.
import { FileId, makeScope, type Scope } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CategoriesFacade } from "../modules/categories/index.ts";
import type { FilesFacade } from "../modules/files/index.ts";
import type { IdentityFacade } from "../modules/identity/index.ts";
import type { NotificationsFacade } from "../modules/notifications/index.ts";
import { loadProductionSchemas } from "../platform/db/__fixtures__/production-schemas.ts";
import { registeredTables } from "../platform/db/tables.ts";
import {
  registerUser,
  sessionCookie,
  STACK_PASSWORD,
  startHttpStack,
  type HttpStack,
} from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
let userTables: string[];
beforeAll(async () => {
  db = await createTestDb();
  // Без worker: задачи, поставленные регистрацией, остаются ожидающими — удаление должно их убрать.
  stack = await startHttpStack(db, { worker: false });
  await loadProductionSchemas();
  userTables = [...registeredTables()].filter(([, kind]) => kind === "user").map(([name]) => name);
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

function facade<F>(id: string): F {
  const module = stack.api.modules.find((m) => m.id === id);
  if (module === undefined) throw new Error(`нет модуля ${id}`);
  return module.facade as F;
}

interface Seeded {
  readonly cookie: string;
  readonly scope: Scope;
  readonly email: string;
  readonly fileId: string;
}

/**
 * Пользователь с данными во всех пользовательских таблицах: регистрация (согласия, письмо, ссылка, задачи), настройка
 * уведомлений по HTTP, файл через фасад (и заявка архива на него); остальные таблицы — строками владельца базы (их сценарии — задачи модулей).
 */
async function seedUser(email: string): Promise<Seeded> {
  const user = await registerUser(stack, db, email, { cloud: true });
  const scope = makeScope(user);
  const ids = [user.householdId, user.userId];
  await db.owner.query(
    "insert into accounts (household_id, user_id, kind) values ($1, $2, 'cash')",
    ids,
  );
  const conversation = await db.owner.query<{ id: string }>(
    "insert into chat_conversations (household_id, user_id) values ($1, $2) returning id",
    ids,
  );
  await db.owner.query(
    `insert into chat_messages (household_id, user_id, conversation_id, role, parts)
     values ($1, $2, $3, 'user', '[{"type":"text","text":"привет"}]'::jsonb)`,
    [...ids, conversation.rows[0]?.id],
  );
  await db.owner.query(
    `insert into action_journal (household_id, user_id, handler, payload, subject, channel)
     values ($1, $2, 'accounts.test', '{}', 'account:x', 'web')`,
    ids,
  );
  await db.owner.query(
    `insert into pending_decisions (household_id, user_id, handler, payload, summary)
     values ($1, $2, 'accounts.test', '{}', '{"key":"decisions.fallback","params":{}}')`,
    ids,
  );
  await db.owner.query(
    `insert into explanations (household_id, user_id, trace)
     values ($1, $2, '{"key":"fin.averageIncome","op":"value","value":1,"inputs":[],"refs":[]}')`,
    ids,
  );
  await db.owner.query(
    `insert into notifications (household_id, user_id, kind, key, params, shown_on_web)
     values ($1, $2, 'goal', 'g-1', '{}', true)`,
    ids,
  );
  // Профиль: анкета (признак и факт) и правка факта — строка ревизии для «Отменить».
  const onboarding = await stack.call("local", "/profile/onboarding", {
    cookie: user.cookie,
    body: { answers: { benefitCategory: false } },
  });
  expect(onboarding.status).toBe(200);
  const fact = await stack.call("local", "/profile/facts", {
    cookie: user.cookie,
    body: { value: { key: "benefitCategory", value: true } },
  });
  expect(fact.status).toBe(200);
  // Счёт с ревизией «до действия» (для «Отменить»): создан и переименован через процедуры.
  const account = await stack.call("local", "/accounts", {
    cookie: user.cookie,
    body: { kind: "deposit", name: "Вклад", currency: "BYN" },
  });
  expect(account.status).toBe(200);
  const created = (await account.json()) as { account: { id: string } };
  const renamed = await stack.call("local", "/accounts/rename", {
    cookie: user.cookie,
    body: { id: created.account.id, name: "Вклад на год" },
  });
  expect(renamed.status).toBe(200);
  // Категории: своя, скрытая встроенная и правило пользователя (CAT-02, CAT-05).
  const category = await stack.call("local", "/categories", {
    cookie: user.cookie,
    body: { name: "Кружки", kind: "expense" },
  });
  expect(category.status).toBe(200);
  const hidden = await stack.call("local", "/categories/hidden", {
    cookie: user.cookie,
    body: { ref: { type: "system", code: "taxi" }, hidden: true },
  });
  expect(hidden.status).toBe(200);
  await facade<CategoriesFacade>("categories").setUserRule(stack.api.platform.scoped(scope), {
    matcher: "merchant",
    pattern: "ТАКСИ",
    category: { type: "system", code: "transport" },
  });
  // Операция на вкладе и её история (TXN-03, TXN-05) — строками владельца.
  const operation = await db.owner.query<{ id: string }>(
    `insert into transactions (household_id, user_id, account_id, type, direction, occurred_on, amount_minor,
       currency, amount_byn_minor, category_code, category_source, source)
     values ($1, $2, $3, 'income', 'in', '2026-10-28', 10000, 'BYN', 10000, 'interest', 'user', 'manual')
     returning id`,
    [...ids, created.account.id],
  );
  await db.owner.query(
    `insert into transaction_revisions (household_id, user_id, transaction_id, batch_id, action, channel, version_after)
     values ($1, $2, $3, uuidv7(), 'created', 'web', 1)`,
    [...ids, operation.rows[0]?.id],
  );
  const preference = await stack.call("local", "/notifications/preferences", {
    cookie: user.cookie,
    body: { kind: "goal", channel: "web", enabled: false },
  });
  expect(preference.status).toBe(200);
  const file = await facade<FilesFacade>("files").save(stack.api.platform.scoped(scope), {
    kind: "receipt-photo",
    name: "чек.jpg",
    mime: "image/jpeg",
    content: new TextEncoder().encode("jpeg"),
  });
  await db.owner.query(
    `insert into privacy_exports (household_id, user_id, status, file_id, file_name, size, finished_at)
     values ($1, $2, 'ready', $3, 'kosht-my-data-2026-10-28.zip', 4, now())`,
    [...ids, file.id],
  );
  return { cookie: user.cookie, scope, email, fileId: file.id };
}

/** Строк домохозяйства в каждой пользовательской таблице. */
async function rowsByTable(householdId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of userTables) {
    const { rows } = await db.owner.query<{ n: number }>(
      `select count(*)::int as n from "${table}" where household_id = $1`,
      [householdId],
    );
    counts[table] = rows[0]?.n ?? -1;
  }
  return counts;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const { rows } = await db.owner.query<{ n: number }>(`select count(*)::int as n ${sql}`, params);
  return rows[0]?.n ?? -1;
}

/** Системные следы пользователя: сессии, ссылки из писем, письма ящика, режим, «прочитано», сам пользователь. */
async function systemTraces(user: Seeded) {
  const { userId, householdId } = user.scope;
  return {
    sessions: await count("from identity_sessions where user_id = $1", [userId]),
    links: await count("from identity_verifications where value = $1", [userId]),
    letters: await count("from mail_messages where recipient = $1", [user.email]),
    mode: await count("from privacy_modes where user_id = $1", [userId]),
    adminReads: await count("from admin_notification_reads where user_id = $1", [userId]),
    user: await count("from identity_users where id = $1", [userId]),
    household: await count("from identity_households where id = $1", [householdId]),
    pendingJobs: await count(
      "from pgboss.job where state < 'active' and data->'scope'->>'householdId' = $1",
      [householdId],
    ),
  };
}

describe("PRIV-06, КП PRIV: удаление аккаунта", () => {
  it("после удаления — 0 строк пользователя во всех userOwnedTable, нет файлов, системных строк и задач; B не изменён", async () => {
    // Администратор первого запуска есть — A, став администратором, не последний.
    const setup = await stack.call("local", "/identity/setup", {
      body: { email: "root@example.test", password: STACK_PASSWORD },
    });
    expect(setup.status).toBe(200);
    const a = await seedUser("a@example.test");
    const b = await seedUser("b@example.test");
    await facade<IdentityFacade>("identity").setRole(a.scope.userId, "admin");
    const notice = await facade<NotificationsFacade>("notifications").notifyAdmins({
      kind: "ai-provider",
      key: "groq:429:2026-10-27",
    });
    const read = await stack.call("local", "/notifications/admin/read", {
      cookie: a.cookie,
      body: { ids: [notice] },
    });
    expect(read.status).toBe(200);

    // Тест полноты: у A есть строка в каждой пользовательской таблице реестра — иначе тест ничего не доказывает.
    const before = await rowsByTable(a.scope.householdId);
    expect(Object.entries(before).filter(([, n]) => n === 0)).toEqual([]);
    expect(await systemTraces(a)).toEqual({
      sessions: 1,
      links: 1,
      letters: 1,
      mode: 1,
      adminReads: 1,
      user: 1,
      household: 1,
      pendingJobs: expect.any(Number),
    });
    expect((await systemTraces(a)).pendingJobs).toBeGreaterThan(0);
    const bBefore = await rowsByTable(b.scope.householdId);
    const bTracesBefore = await systemTraces(b);

    const response = await stack.call("local", "/identity/delete-account", {
      cookie: a.cookie,
      body: { password: STACK_PASSWORD },
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([
      "kosht_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    ]);

    expect(
      Object.entries(await rowsByTable(a.scope.householdId)).filter(([, n]) => n !== 0),
    ).toEqual([]);
    expect(await systemTraces(a)).toEqual({
      sessions: 0,
      links: 0,
      letters: 0,
      mode: 0,
      adminReads: 0,
      user: 0,
      household: 0,
      pendingJobs: 0,
    });
    expect(
      await stack.api.platform.blobs.open(a.scope.householdId, FileId.parse(a.fileId)),
    ).toBeUndefined();
    // Langfuse в тестах выключен — трассы ждут в очереди повторов llm (без scope).
    expect(await count("from llm_trace_deletions where user_id = $1", [a.scope.userId])).toBe(1);
    // Запоздавшую задачу A отбросит перепроверка владельца.
    expect(await stack.api.registries.scopeVerifier?.(a.scope)).toBe(false);
    // Старая cookie A больше не пускает.
    expect((await stack.call("local", "/identity/me", { cookie: a.cookie })).status).toBe(401);

    expect(await rowsByTable(b.scope.householdId)).toEqual(bBefore);
    expect(await systemTraces(b)).toEqual(bTracesBefore);
    const own = await stack.call("local", `/files/${b.fileId}`, { cookie: b.cookie });
    expect(await own.text()).toBe("jpeg");
  });

  it("неверный пароль — INVALID_CREDENTIALS, ничего не удалено, сессия жива", async () => {
    const c = await seedUser("c@example.test");
    const before = await rowsByTable(c.scope.householdId);
    const response = await stack.call("local", "/identity/delete-account", {
      cookie: c.cookie,
      body: { password: "не-тот-пароль-совсем" },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(await rowsByTable(c.scope.householdId)).toEqual(before);
    expect((await stack.call("local", "/identity/me", { cookie: c.cookie })).status).toBe(200);
  });

  it("AUTH-12: последний администратор себя не удаляет — LAST_ADMIN, он не заблокирован и данные на месте", async () => {
    const root = sessionCookie(
      await stack.call("local", "/identity/sign-in", {
        body: { email: "root@example.test", password: STACK_PASSWORD },
      }),
    );
    // A удалён в первом тесте: администратор первого запуска снова единственный.
    const response = await stack.call("local", "/identity/delete-account", {
      cookie: root,
      body: { password: STACK_PASSWORD },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "LAST_ADMIN" });
    expect(await stack.call("local", "/identity/me", { cookie: root })).toMatchObject({
      status: 200,
    });
    expect(
      await count("from identity_users where email = $1 and status = 'active'", [
        "root@example.test",
      ]),
    ).toBe(1);
  });
});
