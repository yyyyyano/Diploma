// BUD-03 и CONSTRAINTS сквозь HTTP и настоящий worker (createJobs, не InlineJobs): «трата → уведомление 80 %» ≤ 3 с на
// 10 прогонах и «импорт 300 операций → ≤ 5 задач пересчёта и по одному уведомлению на порог». Время идёт от ответа API на
// запись операции (коммит уже случился) до сигнала realtime «уведомление» — он уходит при коммите транзакции, которая
// создала строку уведомления. Ожидание — события и опрос состояния, не sleep.
import { SYSTEM_CATEGORIES } from "@kosht/contract";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appDbConfig } from "../platform/db/__fixtures__/app-db-config.ts";
import { listenConnector, type ListenConnection } from "../platform/db/listen.ts";
import { registerUser, startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

let db: TestDb;
let stack: HttpStack;
let listener: ListenConnection;
/** Сигналы «уведомление» по домохозяйствам: момент прихода (мс, монотонные часы). */
const signals: { householdId: string; at: number }[] = [];

beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db);
  listener = await listenConnector(
    appDbConfig(db).config,
    "kosht-test-budgets",
  )({
    onNotification: (payload) => {
      const body = JSON.parse(payload) as { householdId?: string; entity?: string };
      if (body.entity === "notification" && body.householdId !== undefined) {
        signals.push({ householdId: body.householdId, at: performance.now() });
      }
    },
    onLost: (error) => {
      throw error;
    },
  });
});
afterAll(async () => {
  await listener.close();
  await stack.close();
  await db.drop();
});

/** Сегодня и день месяца — по часам процесса: стенд работает на настоящих часах, как и сам сервер. */
const now = new Date();
const monthPrefix = `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const today = `${monthPrefix}-${String(now.getDate()).padStart(2, "0")}`;
const byn = (minor: number) => ({ minor, currency: "BYN" });

async function post(cookie: string, path: string, body: unknown) {
  const response = await stack.call("local", path, { cookie, body });
  expect(response.status, `${path}: ${await response.clone().text()}`).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

const limitNotices = async (householdId: string) =>
  Number(
    (
      await db.owner.query<{ n: string }>(
        "select count(*)::text as n from notifications where household_id = $1 and kind = 'limit'",
        [householdId],
      )
    ).rows[0]?.n,
  );

describe("BUD-03, CONSTRAINTS: трата → уведомление 80 % за ≤ 3 с (10 прогонов)", () => {
  it("от ответа на запись операции до строки уведомления и сигнала realtime — не больше 3 с", async () => {
    const user = await registerUser(stack, db, "limit-latency@example.test");
    const categories = SYSTEM_CATEGORIES.filter((category) => category.kind === "expense").slice(
      0,
      10,
    );
    const timings: number[] = [];
    for (const category of categories) {
      await post(user.cookie, "/budgets/limit", {
        categoryKey: `system:${category.code}`,
        limit: byn(10_000),
      });
      const before = signals.length;
      // 90,00 из 100,00 — 90 %: порог 80 пройден, 100 — нет.
      await post(user.cookie, "/transactions", {
        type: "expense",
        occurredOn: today,
        amount: byn(9_000),
        merchant: "Тест",
        category: { type: "system", code: category.code },
      });
      const committed = performance.now();
      await vi.waitFor(
        () => {
          if (!signals.slice(before).some((s) => s.householdId === user.householdId)) {
            throw new Error("сигнала «уведомление» ещё нет");
          }
        },
        { timeout: 10_000, interval: 5 },
      );
      const signal = signals.slice(before).find((s) => s.householdId === user.householdId);
      timings.push((signal?.at ?? Number.POSITIVE_INFINITY) - committed);
    }
    expect(await limitNotices(user.householdId)).toBe(10);
    const max = Math.max(...timings);
    // Время печатается: оно — само доказательство бюджета (CONSTRAINTS «Трата → уведомление 80 % ≤ 3 с»).
    console.info(
      `BUD-03: трата → уведомление, мс по 10 прогонам: ${timings.map((t) => String(Math.round(t))).join(", ")}; максимум ${String(Math.round(max))} мс`,
    );
    expect(max).toBeLessThanOrEqual(3_000);
  }, 120_000);
});

/** Выписка на `rows` расходов в текущем месяце: остатки сходятся (STMT-04), суммы и описания уникальны (без дублей). */
function statement(rows: number) {
  const lines = [
    "Лесбанк",
    "Выписка по карте ****4821",
    `Период: 01.${monthPrefix.slice(5)}.${monthPrefix.slice(0, 4)} - 28.${monthPrefix.slice(5)}.${monthPrefix.slice(0, 4)}`,
    "Дата;Описание операции;Приход;Расход;Остаток",
  ];
  let balance = 1_000_000;
  for (let i = 0; i < rows; i += 1) {
    const minor = 500 + i;
    balance -= minor;
    const day = String((i % 27) + 1).padStart(2, "0");
    const fmt = (value: number) =>
      `${String(Math.trunc(value / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${String(value % 100).padStart(2, "0")}`;
    lines.push(
      `${day}.${monthPrefix.slice(5)}.${monthPrefix.slice(0, 4)};KINO ZVEZDA MINSK ${String(i)};;${fmt(minor)};${fmt(balance)}`,
    );
  }
  return new Uint8Array(new TextEncoder().encode(`\uFEFF${lines.join("\n")}\n`));
}

async function importStatement(cookie: string, rows: number): Promise<void> {
  const form = new FormData();
  form.set("kind", "statement");
  form.set("files[0]", new File([statement(rows)], "месяц.csv", { type: "text/csv" }));
  const uploaded = await stack.call("local", "/files", { cookie, form });
  expect(uploaded.status).toBe(200);
  const { files } = (await uploaded.json()) as { files: { id: string }[] };
  const { id } = (await post(cookie, "/statements/imports", { fileId: files[0]?.id })) as {
    id: string;
  };
  await vi.waitFor(
    async () => {
      const detail = (await (
        await stack.call("local", `/statements/imports/${id}`, { cookie })
      ).json()) as {
        summary: { status: string };
      };
      if (detail.summary.status !== "ready") throw new Error(detail.summary.status);
    },
    { timeout: 30_000, interval: 250 },
  );
  const confirmed = await stack.call("local", `/statements/imports/${id}/confirm`, {
    cookie,
    post: true,
  });
  expect(confirmed.status).toBe(200);
}

describe("CONSTRAINTS: импорт 300 операций — ≤ 5 задач пересчёта и одно уведомление на порог", () => {
  it("лимит на категорию выписки: траты до 85 % — одно уведомление «80 %»; задач budgets не больше 5", async () => {
    // Какая категория у строк выписки и сколько они стоят — выясняет первый пользователь (без лимитов).
    const probe = await registerUser(stack, db, "import-probe@example.test");
    await importStatement(probe.cookie, 300);
    const found = await db.owner.query<{ category_code: string; sum: string }>(
      `select category_code, sum(amount_byn_minor)::text as sum from transactions
       where household_id = $1 and source = 'statement' group by category_code order by 2 desc`,
      [probe.householdId],
    );
    expect(found.rows).toHaveLength(1);
    const category = found.rows[0];
    const total = Number(category?.sum);
    expect(total).toBeGreaterThan(0);

    const user = await registerUser(stack, db, "import-limit@example.test");
    // Лимит такой, что 300 строк дают 85 %: порог 80 пройден, 100 — нет.
    await post(user.cookie, "/budgets/limit", {
      categoryKey: `system:${category?.category_code}`,
      limit: byn(Math.ceil(total / 0.85)),
    });
    const started = (await db.owner.query<{ now: Date }>("select clock_timestamp() as now")).rows[0]
      ?.now;
    await importStatement(user.cookie, 300);
    await vi.waitFor(
      async () => {
        if ((await limitNotices(user.householdId)) < 1) throw new Error("уведомления ещё нет");
      },
      { timeout: 15_000, interval: 50 },
    );
    // Очередь затихла: ни одного выполняющегося запуска.
    await vi.waitFor(
      async () => {
        const running = await db.owner.query<{ n: string }>(
          "select count(*)::text as n from background_job_run where status = 'running'",
        );
        if (running.rows[0]?.n !== "0") throw new Error("задачи ещё выполняются");
      },
      { timeout: 15_000, interval: 100 },
    );
    expect(await limitNotices(user.householdId)).toBe(1);
    const runs = await db.owner.query<{ kind: string; n: string }>(
      `select kind, count(*)::text as n from background_job_run
       where started_at >= $1 and (kind like 'budgets.%' or kind like 'evt.%.budgets') group by kind`,
      [started],
    );
    const total_runs = runs.rows.reduce((sum, row) => sum + Number(row.n), 0);
    console.info(
      `CONSTRAINTS: задач budgets на импорт 300 операций — ${String(total_runs)}: ${JSON.stringify(runs.rows)}`,
    );
    expect(total_runs).toBeLessThanOrEqual(5);
    expect(total_runs).toBeGreaterThanOrEqual(1);
  }, 120_000);
});
