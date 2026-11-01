// TAX-20, NOTIF-02, DASH-02, AGT-06, P5 сквозь HTTP и корень композиции (api + worker): оплата обучения учреждению образования →
// найденный вычет с суммой калькулятора («до 260» для 2 000 BYN), одна запись на операцию (повтор события дубль не создаёт),
// уведомление «найден вычет», «Не моё» с «Отменить» и без повторного предложения; дети из профиля; жильё — вопрос об учёте
// нуждающихся и ответ фактом профиля; плательщик только НПД ничего не находит; главная показывает активные находки.
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FoundDeduction } from "@kosht/contract";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  registerUser,
  STACK_PASSWORD,
  startHttpStack,
  type HttpStack,
} from "./__fixtures__/http-stack.ts";

const FIXTURES = fileURLToPath(
  new URL("../modules/legal-base/__fixtures__/pravo-by", import.meta.url),
);

let db: TestDb;
let stack: HttpStack;
let dir: string;
beforeAll(async () => {
  db = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "kosht-found-"));
  await cp(FIXTURES, dir, { recursive: true });
  stack = await startHttpStack(db, {
    env: { LEGAL_SOURCE: "fixtures", LEGAL_FIXTURES_DIR: dir, LLM_MODELS_DOWNLOAD: "0" },
  });
  const admin = { email: "root@example.test", password: STACK_PASSWORD };
  const setup = await stack.call("local", "/identity/setup", { body: admin });
  if (setup.status !== 200) throw new Error(`первый запуск не прошёл: ${String(setup.status)}`);
  await vi.waitFor(
    async () => {
      const response = await stack.call("local", "/legal-base/startup-progress");
      const progress = (await response.json()) as { state: string };
      if (progress.state !== "ready") throw new Error("каталог ещё загружается");
    },
    { timeout: 30_000, interval: 300 },
  );
});
afterAll(async () => {
  await stack.close();
  await db.drop();
  await rm(dir, { recursive: true, force: true });
});

const byn = (value: number) => ({ minor: Math.round(value * 100), currency: "BYN" });
const daysAgo = (days: number): string => {
  const day = new Date(Date.now() - days * 86_400_000);
  return day.toISOString().slice(0, 10);
};

type User = Awaited<ReturnType<typeof registerUser>>;
let counter = 0;
const newUser = (name: string): Promise<User> => {
  counter += 1;
  return registerUser(stack, db, `${name}-${String(counter)}@example.test`);
};

const call = async (user: User, path: string, body?: unknown) => {
  const response = await stack.call("local", path, {
    cookie: user.cookie,
    ...(body === undefined ? {} : { body }),
  });
  expect(response.status).toBe(200);
  return response.json();
};
const setFact = (user: User, value: unknown) => call(user, "/profile/facts", { value });
const spend = (
  user: User,
  input: { merchant: string; amount: number; category: string; ago?: number },
) =>
  call(user, "/transactions", {
    type: "expense",
    occurredOn: daysAgo(input.ago ?? 10),
    amount: byn(input.amount),
    merchant: input.merchant,
    category: { type: "system", code: input.category },
  });
const found = async (user: User): Promise<FoundDeduction[]> =>
  ((await call(user, "/tax/found")) as { items: FoundDeduction[] }).items;

/** Очередь подписок tax пуста: все события доставлены и обработаны (иначе «ничего не нашлось» — гонка, а не ответ). */
async function drained(): Promise<void> {
  await vi.waitFor(
    async () => {
      const rows = await db.owner.query<{ n: string }>(
        `select count(*)::text as n from pgboss.job
          where name like 'evt.%.tax' and state in ('created', 'retry', 'active')`,
      );
      if (rows.rows[0]?.n !== "0") throw new Error("события tax ещё в очереди");
    },
    { timeout: 30_000, interval: 200 },
  );
}
const notifications = async (user: User) =>
  (
    await db.owner.query<{ kind: string; params: Record<string, unknown> }>(
      "select kind, params from notifications where user_id = $1 and kind = 'deduction' order by created_at",
      [user.userId],
    )
  ).rows;

describe("TAX-20, TAX-07: оплата обучения → найденный вычет «до 260»", () => {
  it("2 000 BYN учреждению образования в категории «Образование»: сумма калькулятора, основание — операция, уведомление «найден вычет»", async () => {
    const user = await newUser("education");
    await spend(user, { merchant: "БГУ", amount: 2000, category: "education" });
    await vi.waitFor(async () => expect(await found(user)).toHaveLength(1), {
      timeout: 30_000,
      interval: 300,
    });
    const [item] = await found(user);
    expect(item).toMatchObject({
      kind: "education",
      status: "new",
      reason: null,
      payee: "БГУ",
      amount: { amount: { minor: 26_000, currency: "BYN" } },
      operation: { on: daysAgo(10), amount: { minor: 200_000, currency: "BYN" } },
    });
    expect(item?.amount?.traceId).toEqual(expect.any(String));
    await vi.waitFor(async () => expect(await notifications(user)).toHaveLength(1), {
      timeout: 15_000,
      interval: 300,
    });
    expect((await notifications(user))[0]?.params).toMatchObject({
      kind: "education",
      amount: 26_000,
    });
  });

  it("повтор события и посторонние операции дубль не создают; вторая оплата — своя запись", async () => {
    const user = await newUser("education-twice");
    await spend(user, { merchant: "БГУ", amount: 2000, category: "education" });
    await vi.waitFor(async () => expect(await found(user)).toHaveLength(1), {
      timeout: 30_000,
      interval: 300,
    });
    await spend(user, { merchant: "Кофейня", amount: 5, category: "cafes" });
    await spend(user, { merchant: "Кофейня", amount: 6, category: "cafes" });
    await drained();
    expect(await found(user)).toHaveLength(1);
    await spend(user, { merchant: "Минский колледж", amount: 500, category: "education", ago: 3 });
    await vi.waitFor(async () => expect(await found(user)).toHaveLength(2), {
      timeout: 30_000,
      interval: 300,
    });
    await drained();
    expect(await found(user)).toHaveLength(2);
    expect(await notifications(user)).toHaveLength(2);
  });

  it("операции прошлого года просматриваются; позапрошлого — нет", async () => {
    const user = await newUser("education-lastyear");
    const lastYear = `${String(new Date().getUTCFullYear() - 1)}-09-12`;
    const older = `${String(new Date().getUTCFullYear() - 2)}-09-12`;
    for (const day of [lastYear, older]) {
      await call(user, "/transactions", {
        type: "expense",
        occurredOn: day,
        amount: byn(1000),
        merchant: "Университет",
        category: { type: "system", code: "education" },
      });
    }
    await vi.waitFor(async () => expect(await found(user)).toHaveLength(1), {
      timeout: 30_000,
      interval: 300,
    });
    await drained();
    const items = await found(user);
    expect(items).toHaveLength(1);
    expect(items[0]?.operation?.on).toBe(lastYear);
  });

  it("не учреждение образования («Репетитор») и не категория «Образование» — вычета нет", async () => {
    const user = await newUser("education-not");
    await spend(user, { merchant: "Репетитор по английскому", amount: 300, category: "education" });
    await spend(user, { merchant: "БГУ буфет", amount: 8, category: "cafes" });
    await drained();
    expect(await found(user)).toEqual([]);
  });

  it("плательщик только НПД: вычет не находится (TAX-02)", async () => {
    const user = await newUser("npd");
    await setFact(user, { key: "employment", types: ["npd"] });
    await spend(user, { merchant: "БГУ", amount: 2000, category: "education" });
    await drained();
    expect(await found(user)).toEqual([]);
  });
});

describe("TAX-20, P5: «Это не моё» — с «Отменить», больше не предлагается", () => {
  it("отклонённое остаётся в списке со статусом, не возвращается новым событием, «Отменить» возвращает прежнее; на главной — только активные", async () => {
    const user = await newUser("dismiss");
    await spend(user, { merchant: "БГУ", amount: 2000, category: "education" });
    await vi.waitFor(async () => expect(await found(user)).toHaveLength(1), {
      timeout: 30_000,
      interval: 300,
    });
    const [item] = await found(user);
    const id = item?.id ?? "";

    const home = (await call(user, "/dashboard")) as { foundDeductions: FoundDeduction[] };
    expect(home.foundDeductions.map((f) => f.id)).toEqual([id]);

    const shown = await call(user, "/tax/found/shown", { ids: [id] });
    expect(shown).toEqual({ ok: true });
    expect((await found(user))[0]?.status).toBe("shown");

    const dismissed = (await call(user, "/tax/found/status", { id, status: "dismissed" })) as {
      found: FoundDeduction;
      undoToken: string;
    };
    expect(dismissed.found.status).toBe("dismissed");
    expect((await found(user))[0]?.status).toBe("dismissed");
    const homeAfter = (await call(user, "/dashboard")) as {
      foundDeductions: FoundDeduction[];
    };
    expect(homeAfter.foundDeductions).toEqual([]);

    // Новое событие: отклонённое не «воскресает», уведомление не повторяется.
    await spend(user, { merchant: "Кофейня", amount: 5, category: "cafes" });
    await drained();
    expect((await found(user)).map((f) => f.status)).toEqual(["dismissed"]);
    expect(await notifications(user)).toHaveLength(1);

    const undone = await call(user, "/actions/undo", { token: dismissed.undoToken });
    expect(undone).toEqual({ status: "undone" });
    expect((await found(user))[0]?.status).toBe("shown");
  });

  it("«Оформлено» и «Вернуть» — тоже с «Отменить»; чужую запись не тронуть", async () => {
    const owner = await newUser("filed");
    await spend(owner, { merchant: "БГУ", amount: 2000, category: "education" });
    await vi.waitFor(async () => expect(await found(owner)).toHaveLength(1), {
      timeout: 30_000,
      interval: 300,
    });
    const id = (await found(owner))[0]?.id ?? "";
    const filed = (await call(owner, "/tax/found/status", { id, status: "filed" })) as {
      found: FoundDeduction;
    };
    expect(filed.found.status).toBe("filed");

    const stranger = await newUser("stranger");
    const response = await stack.call("local", "/tax/found/status", {
      cookie: stranger.cookie,
      body: { id, status: "dismissed" },
    });
    expect(response.status).toBe(404);
    expect((await found(owner))[0]?.status).toBe("filed");
  });
});

describe("TAX-20: дети в профиле — напоминание о стандартном вычете", () => {
  it("ребёнок до 18 лет: 63 × 13 % = 8,19 BYN в месяц; повторная правка профиля дубль не создаёт; нет детей — напоминание уходит", async () => {
    const user = await newUser("children");
    await setFact(user, {
      key: "children",
      children: [{ name: "Алиса", birthDate: "2017-03-01" }],
    });
    await vi.waitFor(async () => expect(await found(user)).toHaveLength(1), {
      timeout: 30_000,
      interval: 300,
    });
    expect((await found(user))[0]).toMatchObject({
      kind: "children",
      status: "new",
      amount: { amount: { minor: 819, currency: "BYN" } },
      operation: null,
    });
    await setFact(user, { key: "benefitCategory", value: false });
    await drained();
    expect(await found(user)).toHaveLength(1);
    expect(await notifications(user)).toHaveLength(1);

    await setFact(user, {
      key: "children",
      children: [{ name: "Старший", birthDate: "2001-01-01" }],
    });
    await vi.waitFor(async () => expect(await found(user)).toEqual([]), {
      timeout: 30_000,
      interval: 300,
    });
  });
});

describe("TAX-20, AGT-06: жильё — один вопрос об учёте нуждающихся, ответ — факт профиля", () => {
  it("платежи по кредиту и учёт не отмечен — вопрос без уведомления; ответ «состоял» → «проверьте условия» и уведомление; «нет» — ничего", async () => {
    const asked = await newUser("housing");
    await spend(asked, { merchant: "Беларусбанк", amount: 410, category: "loans", ago: 5 });
    await vi.waitFor(async () => expect(await found(asked)).toHaveLength(1), {
      timeout: 30_000,
      interval: 300,
    });
    expect((await found(asked))[0]).toMatchObject({
      kind: "housing",
      reason: "ask-queue",
      amount: null,
      payee: "Беларусбанк",
    });
    await drained();
    expect(await notifications(asked)).toEqual([]);

    await setFact(asked, { key: "housingQueue", status: "now", since: null });
    await vi.waitFor(async () => expect((await found(asked))[0]?.reason).toBe("check"), {
      timeout: 30_000,
      interval: 300,
    });
    await vi.waitFor(async () => expect(await notifications(asked)).toHaveLength(1), {
      timeout: 15_000,
      interval: 300,
    });

    // Повторный ответ или другое событие вопрос не возвращают: учёт известен.
    await setFact(asked, { key: "housingQueue", status: "before", since: null });
    await drained();
    expect((await found(asked))[0]?.reason).toBe("check");
    expect(await notifications(asked)).toHaveLength(1);

    const no = await newUser("housing-no");
    await setFact(no, { key: "housingQueue", status: "no", since: null });
    await spend(no, { merchant: "Беларусбанк", amount: 410, category: "loans", ago: 5 });
    await drained();
    expect(await found(no)).toEqual([]);
  });
});

describe("TAX-20: изоляция", () => {
  it("чужие находки не видны ни в списке, ни на главной", async () => {
    const owner = await newUser("iso-owner");
    await spend(owner, { merchant: "БГУ", amount: 2000, category: "education" });
    await vi.waitFor(async () => expect(await found(owner)).toHaveLength(1), {
      timeout: 30_000,
      interval: 300,
    });
    const other = await newUser("iso-other");
    expect(await found(other)).toEqual([]);
    const home = (await call(other, "/dashboard")) as { foundDeductions: unknown[] };
    expect(home.foundDeductions).toEqual([]);
  });
});
