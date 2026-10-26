// Тест изоляции по реестрам (ROLE-01, SEC-04, ARCHITECTURE §6.2 замок 5): каждая процедура дерева и каждый
// инструмент агента вызываются пользователем A с входом из данных домохозяйства B; ответ — NOT_FOUND или ничего
// из B (ни id, ни email). Случаи строит генератор @kosht/testing по реестрам настоящего корня композиции: новая
// процедура или инструмент без фикстуры ниже — красный тест с подсказкой «добавьте фикстуру». Здесь же — полнота
// владельцев данных: каждая userOwnedTable в defineUserData какого-то модуля (PRIV-05/06).
import { contract } from "@kosht/contract";
import { makeScope, type Scope } from "@kosht/kernel";
import {
  generate,
  leakedIds,
  uncoveredUserTables,
  type IsolationEntry,
  type ProcedureAccess,
} from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { createRouterClient, isProcedure, type AnyProcedure } from "@orpc/server";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { loadConfig } from "../platform/config/config.ts";
import { loadProductionSchemas } from "../platform/db/__fixtures__/production-schemas.ts";
import { registeredTables } from "../platform/db/tables.ts";
import type { HttpContext } from "../platform/http/procedures.ts";
import { requireAdmin, requireLocal, requireSession } from "../platform/http/procedures.ts";
import { memoryLogger } from "../platform/logging/__fixtures__/memory-logger.ts";
import { compose, type Composition } from "./compose.ts";

/** Данные домохозяйства, посеянные тестом: из B берутся входы, по A — сессия. */
interface Household {
  readonly scope: Scope;
  readonly email: string;
  readonly accountId: string;
  readonly conversationId: string;
  /** Запуск агента B: «Стоп» от A по его id не находит запуск (ключ — домохозяйство). */
  readonly runId: string;
  /** Действие B в журнале отмены (undoToken). */
  readonly actionId: string;
  /** Ожидающее решение B «Да/Нет». */
  readonly decisionId: string;
  /** Сохранённый расчёт B. */
  readonly traceId: string;
  /** Уведомление B в ленте сайта. */
  readonly notificationId: string;
}

/**
 * Фикстуры изоляции: как собрать вход процедуры или инструмента из чужих данных (B), либо почему проверять нечего.
 * Новая процедура или инструмент — новая строка здесь (подсказку даст сам тест).
 */
const FIXTURES: Readonly<Record<string, IsolationEntry<Household>>> = {
  "system.health": { exempt: "публичная проба жизни: данных домохозяйства не читает" },
  "events.stream": {
    exempt: "поток сигналов: фильтр по домохозяйству сессии проверяет events-stream.int.test.ts",
  },
  "mail.status": { exempt: "публичная: признак «почта не настроена», данных домохозяйства нет" },
  "mail.mailbox": {
    exempt:
      "локальный ящик (localOnly): системная таблица писем, домохозяйства во входе и в данных нет",
  },
  "identity.status": {
    exempt: "публичная: признак первого запуска системы, данных домохозяйства нет",
  },
  "identity.setup": {
    exempt: "первый запуск (localOnly): создаёт новое домохозяйство, чужих id во входе нет",
  },
  "identity.signIn": { exempt: "публичная: вход по email и паролю, id во входе нет" },
  "identity.register": {
    exempt: "публичная: создаёт новое домохозяйство из email и пароля, чужих id во входе нет",
  },
  "identity.verifyEmail": {
    exempt: "публичная: владельца даёт одноразовый токен из письма, id домохозяйства во входе нет",
  },
  "identity.resendVerification": { input: () => undefined },
  "identity.requestPasswordReset": {
    exempt:
      "публичная: email во входе, ответ одинаковый для любого адреса, данных домохозяйства не отдаёт",
  },
  "identity.resetPassword": {
    exempt: "публичная: владельца даёт одноразовый токен из письма, id домохозяйства во входе нет",
  },
  "identity.recoverWithCode": {
    exempt: "публичная: email и код восстановления во входе, чужой код — INVALID_CREDENTIALS",
  },
  "identity.recoveryCodeStatus": { input: () => undefined },
  "identity.createRecoveryCode": { input: () => undefined },
  "identity.changePassword": {
    exempt:
      "id во входе нет: меняет пароль сессии из cookie запроса (Better Auth), чужого не коснуться",
  },
  "identity.signOut": { exempt: "завершает сессию из cookie запроса, id во входе нет" },
  "identity.me": { input: () => undefined },
  "accounts.list": { input: () => undefined },
  "actions.undo": { input: (b) => ({ token: b.actionId }) },
  "actions.decision": { input: (b) => ({ id: b.decisionId }) },
  "actions.answer": { input: (b) => ({ id: b.decisionId, answer: "yes" }) },
  "explain.get": { input: (b) => ({ id: b.traceId }) },
  "tool:explain_number": { input: (b) => ({ traceId: b.traceId }) },
  "notifications.list": { input: () => ({}) },
  "notifications.markRead": { input: (b) => ({ ids: [b.notificationId] }) },
  "notifications.markAllRead": { input: () => undefined },
  "notifications.preferences": { input: () => undefined },
  "notifications.setPreference": {
    input: () => ({ kind: "goal", channel: "web", enabled: false }),
  },
  "notifications.adminList": { input: () => ({}) },
  "notifications.adminMarkRead": { input: (b) => ({ ids: [b.notificationId] }) },
  "tool:list_accounts": { input: () => ({}) },
  "chat.history": { input: () => undefined },
  "chat.send": {
    input: (b) => ({ conversationId: b.conversationId, text: "Какие у меня счета?" }),
  },
  "chat.stop": { input: (b) => ({ runId: b.runId }) },
};

let db: TestDb;
let dir: string;
let api: Composition;
let a: Household;
let b: Household;

/** Домохозяйство с пользователем и «Наличными» — строками владельца, мимо кода под тестом. */
async function seedHousehold(email: string): Promise<Household> {
  const { rows } = await db.owner.query<{ household_id: string; user_id: string }>(
    "select uuidv7() as household_id, uuidv7() as user_id",
  );
  const ids = rows[0];
  if (ids === undefined) throw new Error("нет id");
  await db.owner.query("insert into identity_households (id) values ($1)", [ids.household_id]);
  await db.owner.query(
    "insert into identity_users (id, name, email, household_id) values ($1, '', $2, $3)",
    [ids.user_id, email, ids.household_id],
  );
  const account = await db.owner.query<{ id: string }>(
    "insert into accounts (household_id, user_id, kind) values ($1, $2, 'cash') returning id",
    [ids.household_id, ids.user_id],
  );
  const conversation = await db.owner.query<{ id: string }>(
    "insert into chat_conversations (household_id, user_id) values ($1, $2) returning id",
    [ids.household_id, ids.user_id],
  );
  const conversationId = conversation.rows[0]?.id ?? "";
  await db.owner.query(
    `insert into chat_messages (household_id, user_id, conversation_id, role, parts)
     values ($1, $2, $3, 'user', jsonb_build_array(jsonb_build_object('type', 'text', 'text', $4::text)))`,
    [ids.household_id, ids.user_id, conversationId, `переписка ${email}`],
  );
  const action = await db.owner.query<{ id: string }>(
    `insert into action_journal (household_id, user_id, handler, payload, subject, channel)
     values ($1, $2, 'accounts.test', '{}', $3, 'web') returning id`,
    [ids.household_id, ids.user_id, `account:${account.rows[0]?.id ?? ""}`],
  );
  const decision = await db.owner.query<{ id: string }>(
    `insert into pending_decisions (household_id, user_id, handler, payload, summary)
     values ($1, $2, 'accounts.test', '{}', jsonb_build_object('key', 'decisions.fallback', 'params', $3::jsonb))
     returning id`,
    [ids.household_id, ids.user_id, JSON.stringify({ email })],
  );
  const explanation = await db.owner.query<{ id: string }>(
    `insert into explanations (household_id, user_id, trace)
     values ($1, $2, jsonb_build_object('key', 'fin.averageIncome', 'op', 'value', 'value', 1, 'inputs',
       '[]'::jsonb, 'refs', jsonb_build_array(jsonb_build_object('kind', 'transaction', 'id', $3::text))))
     returning id`,
    [ids.household_id, ids.user_id, account.rows[0]?.id ?? ""],
  );
  const notification = await db.owner.query<{ id: string }>(
    `insert into notifications (household_id, user_id, kind, key, params, shown_on_web)
     values ($1, $2, 'goal', 'g-1', jsonb_build_object('email', $3::text), true) returning id`,
    [ids.household_id, ids.user_id, email],
  );
  return {
    scope: makeScope({ userId: ids.user_id, householdId: ids.household_id } as never),
    email,
    accountId: account.rows[0]?.id ?? "",
    conversationId,
    runId: randomUUID(),
    actionId: action.rows[0]?.id ?? "",
    decisionId: decision.rows[0]?.id ?? "",
    traceId: explanation.rows[0]?.id ?? "",
    notificationId: notification.rows[0]?.id ?? "",
  };
}

beforeAll(async () => {
  db = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "kosht-isolation-"));
  const { app, admin } = inject("testDb");
  await writeFile(join(dir, "db_app_password"), app.password, { mode: 0o600 });
  await writeFile(join(dir, "db_password"), admin.password, { mode: 0o600 });
  await writeFile(join(dir, "master.key"), randomBytes(32), { mode: 0o600 });
  api = await compose(
    loadConfig({
      DATABASE_URL: `postgres://${app.user}@${app.host}:${String(app.port)}/${db.name}`,
      DB_PASSWORD_FILE: join(dir, "db_app_password"),
      MIGRATION_DATABASE_URL: `postgres://${admin.user}@${admin.host}:${String(admin.port)}/${db.name}`,
      MIGRATION_DB_PASSWORD_FILE: join(dir, "db_password"),
      MASTER_KEY_FILE: join(dir, "master.key"),
      // Тесты офлайн (NFR-11): трассы не уходят в Langfuse, даже если make init создал ключи.
      LANGFUSE_ENABLED: "false",
      DATA_DIR: join(dir, "data"),
    }),
    "api",
    { log: memoryLogger().log },
  );
  a = await seedHousehold("a@example.test");
  b = await seedHousehold("b@example.test");
});

afterAll(async () => {
  await api.close();
  await db.drop();
  await rm(dir, { recursive: true, force: true });
});

/** Доступ процедуры — по её middleware (procedures.ts): authed, admin, localOnly или гость. */
function accessOf(procedure: AnyProcedure): ProcedureAccess {
  const middlewares: readonly unknown[] = procedure["~orpc"].middlewares;
  if (middlewares.includes(requireAdmin)) return "admin";
  if (middlewares.includes(requireSession)) return "authed";
  if (middlewares.includes(requireLocal)) return "local";
  return "public";
}

function proceduresOf(router: unknown, path = ""): Record<string, AnyProcedure> {
  if (isProcedure(router)) return { [path]: router };
  if (typeof router !== "object" || router === null) return {};
  return Object.assign(
    {},
    ...Object.entries(router).map(([key, child]: [string, unknown]) =>
      proceduresOf(child, path === "" ? key : `${path}.${key}`),
    ),
  ) as Record<string, AnyProcedure>;
}

/** Вызов процедуры по пути от имени A (сессия A, локальный вход). */
async function callAsA(path: string, input: unknown, role: "user" | "admin"): Promise<unknown> {
  const context: HttpContext = {
    requestId: "isolation-test",
    listener: "local",
    session: async () => ({ s: api.platform.scoped(a.scope), role }),
    shutdownSignal: new AbortController().signal,
  };
  let node: unknown = createRouterClient(api.router, { context });
  for (const key of path.split(".")) node = (node as Record<string, unknown>)[key];
  return (node as (input: unknown) => Promise<unknown>)(input);
}

describe("ROLE-01, SEC-04: пользователь A с id из B — NOT_FOUND или ничего из B", () => {
  const plan = () => {
    const procedures = proceduresOf(api.router);
    return generate<Household>({
      contract,
      procedures: Object.fromEntries(
        Object.entries(procedures).map(([path, procedure]) => [path, accessOf(procedure)]),
      ),
      tools: api.registries.tools.keys(),
      fixtures: FIXTURES,
    });
  };

  it("у каждой процедуры и инструмента реестров есть фикстура или причина исключения", () => {
    expect(plan().problems).toEqual([]);
  });

  it("каждый случай: ответ — NOT_FOUND или в нём нет ни id, ни email домохозяйства B", async () => {
    const { cases } = plan();
    expect(cases.map((c) => c.name)).toEqual([
      "accounts.list",
      "actions.answer",
      "actions.decision",
      "actions.undo",
      "chat.history",
      "chat.send",
      "chat.stop",
      "explain.get",
      "identity.createRecoveryCode",
      "identity.me",
      "identity.recoveryCodeStatus",
      "identity.resendVerification",
      "notifications.adminList",
      "notifications.adminMarkRead",
      "notifications.list",
      "notifications.markAllRead",
      "notifications.markRead",
      "notifications.preferences",
      "notifications.setPreference",
      "explain_number",
      "list_accounts",
    ]);
    const foreign = [
      b.scope.userId,
      b.scope.householdId,
      b.accountId,
      b.email,
      b.conversationId,
      b.actionId,
      b.decisionId,
      b.traceId,
      b.notificationId,
    ];
    const violations: string[] = [];
    for (const c of cases) {
      try {
        const value = await (c.kind === "tool"
          ? callTool(c.name, c.input(b))
          : callAsA(c.name, c.input(b), c.access === "admin" ? "admin" : "user"));
        const leaked = leakedIds(value, foreign);
        if (leaked.length > 0)
          violations.push(`${c.name}: в ответе данные B (${leaked.join(", ")})`);
      } catch (error) {
        // Чужой id неотличим от несуществующего (ARCHITECTURE §6.3): допустим только NOT_FOUND.
        const code = (error as { code?: unknown }).code;
        if (code !== "NOT_FOUND")
          violations.push(`${c.name}: ошибка ${String(code)} вместо NOT_FOUND`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("положительный контроль: A видит свои «Наличные» и свой email", async () => {
    expect(await callAsA("accounts.list", undefined, "user")).toMatchObject({
      items: [{ id: a.accountId }],
    });
    expect(await callAsA("identity.me", undefined, "user")).toMatchObject({ email: a.email });
  });
});

/** Инструмент агента от имени A: scope запуска — A (ARCHITECTURE §6.4). */
async function callTool(name: string, input: unknown): Promise<unknown> {
  const tool = api.registries.tools.get(name);
  if (tool === undefined) throw new Error(`нет инструмента ${name}`);
  const ctx = {
    s: api.platform.scoped(a.scope),
    requestId: "isolation-test",
    channel: "web" as const,
  };
  return tool.kind === "destructive"
    ? tool.propose(ctx, input as never)
    : tool.execute(ctx, input as never);
}

describe("PRIV-05/06: полнота владельцев данных", () => {
  it("каждая userOwnedTable — в defineUserData какого-то модуля", async () => {
    await loadProductionSchemas();
    const userTables = [...registeredTables()]
      .filter(([, kind]) => kind === "user")
      .map(([name]) => name);
    expect(userTables).toContain("accounts");
    expect(uncoveredUserTables(userTables, api.registries.userData)).toEqual([]);
  });
});
