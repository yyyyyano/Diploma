// Бюджет «главная (дашборд) ≤ 300 мс p95 на сервере» на демо-данных (CONSTRAINTS.md, DASH-01…04, DEMO-01; повторный замер
// после синтетического набора dashboard.bench.ts) — `make bench`. Настоящий корень композиции, демо-пользователь с полной
// историей (6 месяцев, чеки, лимиты, цели, итоги недели), worker доработал события записи (регулярные платежи, календарь,
// вычеты). Замеряется `dashboard.overview` целиком — настоящие соседи, аудит SQL, сборка ответа и `explain.saveMany`;
// прогрев отдельно. p95 печатается из этого прогона.
import { LocalDate, makeScope } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DashboardFacade } from "../modules/dashboard/index.ts";
import type { IdentityFacade } from "../modules/identity/index.ts";
import { startHttpStack, type HttpStack } from "./__fixtures__/http-stack.ts";

const BUDGET_MS = 300;

let db: TestDb;
let stack: HttpStack;
beforeAll(async () => {
  db = await createTestDb();
  stack = await startHttpStack(db, { env: { DEMO_AUTOSTART: "0" } });
});
afterAll(async () => {
  await stack.close();
  await db.drop();
});

function p95(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

describe("DASH-01, DEMO-01: главная на демо-данных", () => {
  it(`overview целиком (с saveMany) — p95 не больше ${String(BUDGET_MS)} мс`, async () => {
    const response = await stack.call("local", "/demo/sign-in", { post: true });
    expect(response.status).toBe(200);
    const identity = stack.api.modules.find((m) => m.id === "identity")?.facade as IdentityFacade;
    const { scope } = await identity.ensureDemoUser();
    const s = stack.api.platform.scoped(makeScope(scope));
    // События записи (регулярные платежи, календарь, вычеты, пороги лимитов) доработал worker: очередь пуста.
    await vi.waitFor(
      async () => {
        const open = await db.owner.query<{ n: number }>(
          "select count(*)::int as n from pgboss.job where state in ('created', 'retry', 'active') and name like 'evt.%'",
        );
        expect(open.rows[0]?.n).toBe(0);
      },
      { timeout: 120_000, interval: 500 },
    );
    await db.owner.query("analyze");

    const dashboard = stack.api.modules.find((m) => m.id === "dashboard")
      ?.facade as DashboardFacade;
    const today = LocalDate.fromInstant(new Date(), "Europe/Minsk");
    const monthStart = LocalDate.parse(`${today.slice(0, 7)}-01`);
    const input = { from: monthStart, to: today };
    const previous = {
      from: LocalDate.parse(`${LocalDate.addDays(monthStart, -1).slice(0, 7)}-01`),
      to: LocalDate.addDays(monthStart, -1),
    };
    for (let i = 0; i < 10; i += 1) await dashboard.overview(s, input);
    const samples: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const started = performance.now();
      await dashboard.overview(s, i % 5 === 4 ? previous : input);
      samples.push(performance.now() - started);
    }
    const value = p95(samples);
    console.log(
      `bench dashboard.overview · демо-пользователь, 6 мес.: p95 = ${value.toFixed(1)} мс`,
    );
    const view = await dashboard.overview(s, input);
    expect(view.hasData).toBe(true);
    expect(view.limits.length).toBeGreaterThanOrEqual(4);
    expect(view.goals).toHaveLength(2);
    expect(value).toBeLessThanOrEqual(BUDGET_MS);
  });
});
