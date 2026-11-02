// DEMO-01…04 сквозь корень композиции на настоящей БД: вход демо-пользователем (только локальный слушатель), история на 6 месяцев
// от «сегодня» через фасады модулей, чеки со статусами «сходится / перепроверка / требует проверки», лимиты на 80 % и выше,
// цели, итоги недели; воспроизводимость (две базы — одни данные без id); ни одного вызова модели (llm_usage пуст); изоляция от
// реальных пользователей; «Пересоздать демо-данные» заменяет только данные демо; администратор демо не удаляет.
// «Сегодня» фиксируется подменой Date (часы приложения берут `new Date()`): тест не зависит от дня запуска.
import { makeScope } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { BudgetsFacade } from "../modules/budgets/index.ts";
import type { IdentityFacade } from "../modules/identity/index.ts";
import { recreateDemoData } from "./demo-reset.ts";
import type { WeeklyFacade } from "../modules/weekly/index.ts";
import {
  registerUser,
  sessionCookie,
  STACK_PASSWORD,
  startHttpStack,
  type HttpStack,
} from "./__fixtures__/http-stack.ts";

const NOW = "2026-10-21T10:00:00Z";

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(NOW) });
  db = await createTestDb();
  stack = await startHttpStack(db, { worker: false });
});
afterAll(async () => {
  await stack.close();
  await db.drop();
  vi.useRealTimers();
});
afterEach(() => {
  vi.setSystemTime(new Date(NOW));
});

const facade = <T>(id: string): T => {
  const found = stack.api.modules.find((module) => module.id === id)?.facade;
  if (found === undefined) throw new Error(`нет фасада ${id}`);
  return found as T;
};

/** Сценарии демо-пользователя: scope отдаёт identity, как и самому модулю demo. */
async function demoScope(onDb = stack) {
  const identity = onDb.api.modules.find((module) => module.id === "identity")
    ?.facade as IdentityFacade;
  const { scope } = await identity.ensureDemoUser();
  return onDb.api.platform.scoped(makeScope(scope));
}

async function signInDemo(onStack: HttpStack = stack) {
  return onStack.call("local", "/demo/sign-in", { post: true });
}

/** Данные демо без id, времён создания и версий — то, что должно совпасть при повторной записи. */
async function dump(database: TestDb, householdId: string) {
  const q = async (sql: string) =>
    (await database.owner.query(sql, [householdId])).rows as Record<string, unknown>[];
  return {
    accounts: await q(
      `select kind, name, bank, mask, currency, initial_balance_minor, balance_minor, balance_on::text as balance_on from accounts where household_id = $1 order by bank nulls first, mask nulls first, kind`,
    ),
    transactions: await q(
      `select occurred_on::text as occurred_on, description, amount_minor, currency, direction, type, category_code, pending, needs_review, source, amount_byn_minor from transactions where household_id = $1 order by occurred_on, description, amount_minor, direction, type`,
    ),
    splits: await q(
      `select category_code, amount_minor from transaction_splits where household_id = $1 order by category_code, amount_minor`,
    ),
    receipts: await q(
      `select status, rechecks, total_minor, store_name, purchase_date::text as purchase_date, disputed_lines, remainder_minor, payment_method, card_last4 from receipts where household_id = $1 order by purchase_date, store_name`,
    ),
    items: await q(
      `select position, name, line_total_minor, category_code, disputed, warranty from receipt_items where household_id = $1 order by name, position`,
    ),
    limits: await q(
      `select category_key, limit_minor from budget_limits where household_id = $1 order by category_key`,
    ),
    goals: await q(
      `select name, kind, target_minor, deadline::text as deadline from budget_goals where household_id = $1 order by name`,
    ),
    contributions: await q(
      `select amount_minor, made_on::text as made_on from budget_contributions where household_id = $1 order by amount_minor`,
    ),
    weeks: await q(
      `select week_start::text as week_start, status, text, text_source from weekly_summaries where household_id = $1 order by week_start`,
    ),
    facts: await q(
      `select key, status, source from profile_facts where household_id = $1 and deleted_at is null and source <> 'system' order by key`,
    ),
  };
}

describe("DEMO-04: вход демо-пользователем", () => {
  it("кнопка на локальном слушателе: демо создаётся, сессия выдана, карточка — демо; повтор не создаёт второго", async () => {
    const response = await signInDemo();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ email: "irina.k@example.by", role: "user" });
    const cookie = sessionCookie(response);
    const me = await stack.call("local", "/identity/me", { cookie });
    expect(await me.json()).toMatchObject({ email: "irina.k@example.by" });

    expect((await signInDemo()).status).toBe(200);
    const users = await db.owner.query(
      "select demo from identity_users where email = 'irina.k@example.by'",
    );
    expect(users.rows).toEqual([{ demo: true }]);
  });

  it("с сетевого слушателя процедуры нет — NOT_FOUND, демо-вход там невозможен", async () => {
    const response = await stack.call("lan", "/demo/sign-in", { post: true });
    expect(response.status).toBe(404);
  });

  it("облачное согласие у демо выдано (иначе показ шёл бы на медленной локальной модели)", async () => {
    const s = await demoScope();
    const rows = await db.owner.query(
      "select kind, granted from privacy_consents where user_id = $1 order by kind",
      [s.scope.userId],
    );
    expect(rows.rows).toEqual([
      { kind: "cloud", granted: true },
      { kind: "personal-data", granted: true },
    ]);
  });
});

describe("DEMO-01: что в наборе", () => {
  it("6 месяцев операций до сегодня, ни одной в будущем; счета сходятся с остатками из макета; переводы и снятия — парами", async () => {
    await signInDemo();
    const s = await demoScope();
    const h = s.scope.householdId;
    const range = await db.owner.query<{ first: string; last: string; n: string }>(
      "select min(occurred_on)::text as first, max(occurred_on)::text as last, count(*) as n from transactions where household_id = $1 and source = 'statement'",
      [h],
    );
    expect(range.rows[0]?.first).toBe("2026-04-22");
    expect((range.rows[0]?.last ?? "9999") <= "2026-10-21").toBe(true);
    expect(Number(range.rows[0]?.n)).toBeGreaterThan(200);

    const balances = await db.owner.query<{
      bank: string | null;
      kind: string;
      balance_minor: string;
      currency: string;
    }>(
      "select bank, kind, balance_minor, currency from accounts where household_id = $1 order by bank nulls first, kind",
      [h],
    );
    const by = (bank: string | null, kind: string) =>
      Number(balances.rows.find((row) => row.bank === bank && row.kind === kind)?.balance_minor);
    expect(by("Беларусбанк", "card")).toBe(128_437);
    expect(by("Приорбанк", "card")).toBe(41_290);
    expect(by("Беларусбанк", "savings")).toBe(215_000);
    expect(by("Альфа-Банк", "card")).toBe(32_000);
    expect(by(null, "cash")).toBe(18_650);
    expect(balances.rows.find((row) => row.bank === "Альфа-Банк")?.currency).toBe("USD");

    const unpaired = await db.owner.query(
      "select 1 from transactions where household_id = $1 and type = 'transfer' and transfer_pair_id is null",
      [h],
    );
    expect(unpaired.rows).toHaveLength(0);
  });

  it("зарплата, аванс, кредит, подписки, оплата обучения БГУ, ОСАГО; категории — встроенные, заданные явно (источник user)", async () => {
    await signInDemo();
    const s = await demoScope();
    const h = s.scope.householdId;
    const count = async (where: string) =>
      Number(
        (
          await db.owner.query<{ n: string }>(
            `select count(*) as n from transactions where household_id = $1 and ${where}`,
            [h],
          )
        ).rows[0]?.n,
      );
    expect(
      await count("category_code = 'salary' and amount_minor = 144000"),
    ).toBeGreaterThanOrEqual(5);
    expect(await count("category_code = 'salary' and amount_minor = 96000")).toBeGreaterThanOrEqual(
      5,
    );
    expect(await count("category_code = 'loans' and amount_minor = 41000")).toBeGreaterThanOrEqual(
      5,
    );
    expect(await count("category_code = 'education' and amount_minor = 200000")).toBe(1);
    expect(await count("description like '%ОСАГО%'")).toBe(1);
    expect(await count("currency = 'USD'")).toBeGreaterThanOrEqual(5);
    expect(await count("type = 'refund' and refund_of_id is not null")).toBe(1);
    // Ни одна операция истории не категоризирована фоном или моделью: категории заданы явно.
    expect(await count("source = 'statement' and category_source <> 'user'")).toBe(0);
  });

  it("профиль: наёмный работник, двое детей, анкета пройдена; квартира есть", async () => {
    await signInDemo();
    const s = await demoScope();
    const h = s.scope.householdId;
    const facts = await db.owner.query<{ key: string; value: Record<string, unknown> }>(
      "select key, value from profile_facts where household_id = $1 and deleted_at is null order by key",
      [h],
    );
    // Сверх анкеты система сама выводит предположения (доход, обязательные платежи): здесь — то, что записало демо.
    expect(facts.rows.map((row) => row.key)).toEqual(
      expect.arrayContaining([
        "benefitCategory",
        "children",
        "employment",
        "mainEmployer",
        "property.apartment",
        "youngSpecialist",
      ]),
    );
    const children = facts.rows.find((row) => row.key === "children")?.value as {
      children: { name: string }[];
    };
    expect(children.children.map((child) => child.name)).toEqual(["Максим", "Алиса"]);
    const onboarding = await db.owner.query(
      "select 1 from profiles where household_id = $1 and onboarding_done_at is not null",
      [h],
    );
    expect(onboarding.rows).toHaveLength(1);
  });

  it("пять чеков: сходятся, перепроверка исправила строку 2, «требует проверки» (строки 5 и 9, остаток 1,37), наличный, с гарантией", async () => {
    await signInDemo();
    const s = await demoScope();
    const rows = await db.owner.query<{
      store_name: string;
      status: string;
      rechecks: number;
      disputed_lines: number[];
      remainder_minor: string;
      total_minor: string;
    }>(
      "select store_name, status, rechecks, disputed_lines, remainder_minor, total_minor from receipts where household_id = $1 order by purchase_date",
      [s.scope.householdId],
    );
    expect(
      rows.rows.map((row) => [row.store_name, row.status, row.rechecks, row.total_minor]),
    ).toEqual([
      ["Электросила", "ok", 0, "38900"],
      ["Евроопт", "ok", 0, "4730"],
      ["Аптека Белфармация №15", "ok", 0, "2345"],
      ["Гиппо", "ok", 1, "3445"],
      ["Корона", "needs-review", 2, "13280"],
    ]);
    const korona = rows.rows.find((row) => row.store_name === "Корона");
    expect(korona?.disputed_lines).toEqual([5, 9]);
    expect(korona?.remainder_minor).toBe("137");
    const photos = await db.owner.query(
      "select 1 from files where household_id = $1 and kind = 'receipt-photo'",
      [s.scope.householdId],
    );
    expect(photos.rows).toHaveLength(5);
    // Чек Евроопта и техники слиты с платежом выписки (TXN-10): покупка в расходах одна, а не две.
    const merged = await db.owner.query<{ description: string; receipt_id: string | null }>(
      "select description, receipt_id from transactions where household_id = $1 and receipt_id is not null and source = 'statement' order by description",
      [s.scope.householdId],
    );
    expect(merged.rows.map((row) => row.description)).toEqual(
      ["ЭЛЕКТРОСИЛА", "EVROOPT T-0042 MINSK"].toSorted(),
    );
    const notice = await db.owner.query(
      "select kind from notifications where household_id = $1 and kind = 'receipt-review'",
      [s.scope.householdId],
    );
    expect(notice.rows).toHaveLength(1);
  });

  it("лимиты: кафе около 84 %, такси превышен, продукты 73 %, развлечения 31 %; цели: копилка 640 из 1 800 и по счёту «Отпуск» 2 150 из 3 000", async () => {
    await signInDemo();
    const s = await demoScope();
    const overview = await facade<BudgetsFacade>("budgets").overview(s);
    const percent = (code: string) =>
      overview.limits.find((limit) => limit.categoryKey === `system:${code}`)?.percent;
    expect(percent("cafes")).toBeGreaterThanOrEqual(80);
    expect(percent("cafes")).toBeLessThan(100);
    expect(percent("taxi")).toBeGreaterThan(100);
    expect(percent("groceries")).toBeGreaterThanOrEqual(70);
    expect(percent("groceries")).toBeLessThanOrEqual(75);
    expect(percent("leisure")).toBeGreaterThanOrEqual(28);
    expect(percent("leisure")).toBeLessThanOrEqual(33);
    const piggy = overview.goals.find((goal) => goal.kind === "piggy");
    const linked = overview.goals.find((goal) => goal.kind === "account");
    expect(piggy).toMatchObject({
      name: "Новый ноутбук",
      saved: { minor: 64_000 },
      target: { minor: 180_000 },
    });
    expect(linked).toMatchObject({
      name: "Отпуск летом",
      saved: { minor: 215_000 },
      target: { minor: 300_000 },
    });
    const alerts = await db.owner.query(
      "select kind from notifications where household_id = $1 and kind like 'limit%' order by kind",
      [s.scope.householdId],
    );
    expect(alerts.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("история итогов недели: 8 недель, текст по шаблону; последняя — карточка главной", async () => {
    await signInDemo();
    const s = await demoScope();
    const history = await facade<WeeklyFacade>("weekly").history(s, 20);
    expect(history).toHaveLength(8);
    expect(history.every((summary) => summary.textSource === "template")).toBe(true);
    expect((await facade<WeeklyFacade>("weekly").latest(s))?.weekStart).toBe("2026-10-12");
  });
});

describe("DEMO-02: без модели и воспроизводимо", () => {
  it("журнал расхода llm_usage пуст: генерация демо не вызывает моделей и не тратит лимиты", async () => {
    await signInDemo();
    const usage = await db.owner.query("select count(*)::int as n from llm_usage");
    expect(usage.rows[0]).toEqual({ n: 0 });
  });

  it("две базы с одинаковым днём — одинаковые данные до последнего знака (без id)", async () => {
    await signInDemo();
    const first = await dump(db, (await demoScope()).scope.householdId);

    const otherDb = await createTestDb();
    const other = await startHttpStack(otherDb, { worker: false });
    try {
      expect((await signInDemo(other)).status).toBe(200);
      const second = await dump(otherDb, (await demoScope(other)).scope.householdId);
      expect(second).toEqual(first);
      expect(first.transactions.length).toBeGreaterThan(200);
    } finally {
      await other.close();
      await otherDb.drop();
    }
  }, 120_000);

  it("на другой день история сдвигается вместе с ним: «последние 6 месяцев» — всегда до дня показа", async () => {
    const shifted = await createTestDb();
    vi.setSystemTime(new Date("2027-01-15T10:00:00Z"));
    const other = await startHttpStack(shifted, { worker: false });
    try {
      expect((await signInDemo(other)).status).toBe(200);
      const s = await demoScope(other);
      const range = await shifted.owner.query<{ first: string; last: string }>(
        "select min(occurred_on)::text as first, max(occurred_on)::text as last from transactions where household_id = $1 and source = 'statement'",
        [s.scope.householdId],
      );
      expect(range.rows[0]?.first).toBe("2026-07-16");
      expect((range.rows[0]?.last ?? "9999") <= "2027-01-15").toBe(true);
    } finally {
      await other.close();
      await shifted.drop();
    }
  }, 120_000);
});

describe("DEMO-03: изоляция и пересоздание", () => {
  it("реальный пользователь не видит демо-данные и не мешает им: свои счета и операции — только свои", async () => {
    await signInDemo();
    const real = await registerUser(stack, db, "real-user@example.test");
    const accounts = await stack.call("local", "/accounts", { cookie: real.cookie });
    expect(accounts.status).toBe(200);
    const list = (await accounts.json()) as { items: { bank: string | null }[] };
    // «Наличные» создаёт фоновая подписка (в этом стенде без worker); главное — демо-счетов банков здесь нет.
    expect(list.items.every((item) => item.bank === null)).toBe(true);
    const operations = await db.owner.query(
      "select count(*)::int as n from transactions where household_id = $1",
      [real.householdId],
    );
    expect(operations.rows[0]).toEqual({ n: 0 });
  });

  it("«Пересоздать демо-данные» — только администратору; данные демо заменены на свежие, реальный пользователь не затронут, согласие на месте", async () => {
    await signInDemo();
    const admin = { email: "demo-root@example.test", password: STACK_PASSWORD };
    expect((await stack.call("local", "/identity/setup", { body: admin })).status).toBe(200);
    const root = sessionCookie(await stack.call("local", "/identity/sign-in", { body: admin }));
    const real = await registerUser(stack, db, "kept-user@example.test");
    const plain = await stack.call("local", "/admin/system/demo", {
      cookie: real.cookie,
      post: true,
    });
    expect(plain.status).toBe(403);

    const s = await demoScope();
    const before = await dump(db, s.scope.householdId);
    const realAccounts = async () =>
      (
        await db.owner.query("select count(*)::int as n from accounts where household_id = $1", [
          real.householdId,
        ])
      ).rows[0];
    const realBefore = await realAccounts();
    await db.owner.query(
      "delete from transactions where household_id = $1 and description = 'Кинотеатр Октябрь'",
      [s.scope.householdId],
    );
    await db.owner.query(
      "update budget_limits set limit_minor = limit_minor + 100 where household_id = $1",
      [s.scope.householdId],
    );

    const response = await stack.call("local", "/admin/system/demo", { cookie: root, post: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ receipts: 5, limits: 4, goals: 2, weeks: 8 });
    expect(await dump(db, s.scope.householdId)).toEqual(before);
    const demoUsers = await db.owner.query(
      "select count(*)::int as n from identity_users where demo",
    );
    expect(demoUsers.rows[0]).toEqual({ n: 1 });
    const consent = await db.owner.query(
      "select granted from privacy_consents where user_id = $1 and kind = 'cloud'",
      [s.scope.userId],
    );
    expect(consent.rows).toEqual([{ granted: true }]);
    const usage = await db.owner.query("select count(*)::int as n from llm_usage");
    expect(usage.rows[0]).toEqual({ n: 0 });
    expect(await realAccounts()).toEqual(realBefore);
  }, 120_000);

  it("`make demo-reset` — тот же recreate из терминала: данные заменены, пользователь один, отчёт с числами", async () => {
    await signInDemo();
    const s = await demoScope();
    const before = await dump(db, s.scope.householdId);
    await db.owner.query("delete from budget_limits where household_id = $1", [
      s.scope.householdId,
    ]);
    const report = await recreateDemoData(stack.api);
    expect(report).toMatchObject({ receipts: 5, limits: 4, goals: 2, weeks: 8 });
    expect(await dump(db, s.scope.householdId)).toEqual(before);
  }, 60_000);

  it("в «Пользователях» демо отмечен, и администратор его не удаляет — CONFLICT, учётная запись и данные на месте", async () => {
    await signInDemo();
    const admin = { email: "demo-root2@example.test", password: STACK_PASSWORD };
    await stack.call("local", "/identity/setup", { body: admin }).catch(() => undefined);
    const root = sessionCookie(
      await stack.call("local", "/identity/sign-in", { body: admin }).then(async (response) =>
        response.status === 200
          ? response
          : stack.call("local", "/identity/sign-in", {
              body: { email: "demo-root@example.test", password: STACK_PASSWORD },
            }),
      ),
    );
    const list = (await (await stack.call("local", "/admin/users", { cookie: root })).json()) as {
      items: { id: string; email: string; demo: boolean }[];
    };
    const demo = list.items.find((user) => user.email === "irina.k@example.by");
    expect(demo?.demo).toBe(true);
    const removed = await stack.call("local", "/admin/users/delete", {
      cookie: root,
      body: { id: demo?.id, email: "irina.k@example.by" },
    });
    expect(removed.status).toBe(409);
    expect(await removed.json()).toMatchObject({ code: "CONFLICT" });
    expect((await demoScope()).scope.userId).toBe(demo?.id);
  });
});
