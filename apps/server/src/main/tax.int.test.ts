// TAX-01…07, TAX-04, LEGAL-12, EXPL-02 сквозь HTTP и корень композиции (api + worker, законы — из сохранённых страниц pravo.by, без
// сети): калькулятор «Обучение / Жильё / Дети» по настоящему профилю, подтверждённой таблице ставок, цитатам НК и сохранённой трассе.
// Числа примеров TAX-07 — как в SPEC; взнос ФСЗН в таблице ждёт «Подтвердить», пока тест не подтвердит его через админку.
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeductionResult } from "@kosht/contract";
import { makeScope, type TraceId } from "@kosht/kernel";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ExplainFacade } from "../modules/explain/index.ts";
import {
  registerUser,
  sessionCookie,
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
let root: string;
beforeAll(async () => {
  db = await createTestDb();
  dir = await mkdtemp(join(tmpdir(), "kosht-tax-"));
  await cp(FIXTURES, dir, { recursive: true });
  stack = await startHttpStack(db, {
    env: { LEGAL_SOURCE: "fixtures", LEGAL_FIXTURES_DIR: dir, LLM_MODELS_DOWNLOAD: "0" },
  });
  const admin = { email: "root@example.test", password: STACK_PASSWORD };
  const setup = await stack.call("local", "/identity/setup", { body: admin });
  if (setup.status !== 200) throw new Error(`первый запуск не прошёл: ${String(setup.status)}`);
  root = sessionCookie(await stack.call("local", "/identity/sign-in", { body: admin }));
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

const byn = (value: number) => ({ minor: value * 100, currency: "BYN" });
const calc = async (cookie: string, body: unknown): Promise<DeductionResult> => {
  const response = await stack.call("local", "/tax/calculate", { cookie, body });
  expect(response.status).toBe(200);
  return (await response.json()) as DeductionResult;
};
const setFact = async (cookie: string, value: unknown) => {
  const response = await stack.call("local", "/profile/facts", { cookie, body: { value } });
  expect(response.status).toBe(200);
};

describe("доступ", () => {
  it("гость расчёт не получает", async () => {
    const response = await stack.call("local", "/tax/calculate", {
      body: { kind: "children" },
    });
    expect(response.status).toBe(401);
  });
});

describe("TAX-07, пример 1: обучение 2 000 BYN", () => {
  it("до 260,00 BYN по ставке 13 %, цитата п. 1.1 ст. 210 НК дословно, чек-лист вычета на обучение, «Откуда эта цифра?» — сохранённый расчёт", async () => {
    const user = await registerUser(stack, db, "education@example.test");
    const result = await calc(user.cookie, { kind: "education", paid: byn(2000) });
    expect(result).toMatchObject({
      status: "ok",
      ratePercent: 13,
      checklistId: "deduction-education",
      flags: ["upper-bound", "ask-gross"],
    });
    expect(result.savingTotal?.amount).toEqual(byn(260));
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0]).toMatchObject({ kind: "quote", label: "ст. 210, п. 1.1" });
    expect(result.citations[0]?.kind === "quote" && result.citations[0].text).toContain(
      "первого высшего, первого среднего специального или первого профессионально-технического образования",
    );

    const explain = stack.api.modules.find((m) => m.id === "explain")?.facade as ExplainFacade;
    const saved = await explain.get(
      stack.api.platform.scoped(makeScope(user)),
      result.savingTotal?.traceId as TraceId,
    );
    expect(saved.trace).toMatchObject({ key: "tax.saving.education", value: byn(260) });
    expect(saved.trace.inputs.map((input) => input.key)).toEqual([
      "tax.education.deduction",
      "tax.incomeRate",
    ]);
    // Ставка в трассе ведёт к версии фрагмента ст. 214 (основание — текст нормы, а не память).
    expect(saved.trace.inputs[1]?.refs).toEqual([
      { kind: "fragmentVersion", id: expect.any(String) },
    ]);
  });

  it("облагаемый доход за год 1 500: экономия 195,00, остаток 500,00 переносится", async () => {
    const user = await registerUser(stack, db, "education-small@example.test");
    const result = await calc(user.cookie, {
      kind: "education",
      paid: byn(2000),
      annualTaxable: byn(1500),
    });
    expect(result.savingTotal?.amount).toEqual(byn(195));
    expect(result.carryOver?.amount).toEqual(byn(500));
  });
});

describe("TAX-07, пример 3: двое детей (PROF-06)", () => {
  it("по детям из профиля — 240 вычета, 31,20 в месяц, 374,40 в год; ребёнок старше 18 не считается", async () => {
    const user = await registerUser(stack, db, "children@example.test");
    await setFact(user.cookie, { key: "employment", types: ["employee"] });
    await setFact(user.cookie, {
      key: "children",
      children: [
        { name: "Максим", birthDate: "2009-06-01" },
        { name: "Алиса", birthDate: "2017-03-01" },
        { name: "Старший", birthDate: "2001-01-01" },
      ],
    });
    const result = await calc(user.cookie, { kind: "children" });
    expect(result.children).toEqual({ count: 2, increased: true });
    expect(result.deduction?.amount).toEqual(byn(240));
    expect(result.savingMonthly?.amount).toEqual({ minor: 3120, currency: "BYN" });
    expect(result.savingYear?.amount).toEqual({ minor: 37_440, currency: "BYN" });
    expect(result.checklistId).toBe("deduction-standard");
  });

  it("чужие дети не видны: у другого пользователя «Дети» — «нет детей»", async () => {
    const other = await registerUser(stack, db, "no-children@example.test");
    const result = await calc(other.cookie, { kind: "children" });
    expect(result).toMatchObject({ status: "not-applicable", reason: "no-children" });
  });
});

describe("TAX-07, пример 2 и TAX-04: квартира 120 000 BYN", () => {
  it("зарплата начислена 2 500 — до 15 600,00 BYN, 48 месяцев; цитата п. 1.1 ст. 211 НК; чек-лист вычета на жильё", async () => {
    const user = await registerUser(stack, db, "housing@example.test");
    const result = await calc(user.cookie, {
      kind: "housing",
      expenses: byn(120_000),
      income: { amount: byn(2500), basis: "gross" },
    });
    expect(result.savingTotal?.amount).toEqual(byn(15_600));
    expect(result.term).toMatchObject({ months: 48, approx: false });
    expect(result.checklistId).toBe("deduction-housing");
    expect(result.citations[0]).toMatchObject({ kind: "quote", label: "ст. 211, п. 1.1" });
  });

  it("2 500 «на руки»: пока взнос ФСЗН не подтверждён — оценки нет, срока нет и вопрос о зарплате; после «Подтвердить» — ≈ 41 месяц с пометкой «оценка»", async () => {
    const user = await registerUser(stack, db, "housing-net@example.test");
    const input = {
      kind: "housing",
      expenses: byn(120_000),
      income: { amount: byn(2500), basis: "net" },
    };
    const waiting = await calc(user.cookie, input);
    expect(waiting.term).toBeNull();
    expect(waiting.termReason).toBe("no-income");
    expect(waiting.flags).toEqual(["ask-gross"]);

    const table = (await (await stack.call("local", "/admin/rates", { cookie: root })).json()) as {
      items: { id: string; param: string; status: string }[];
    };
    const pending = table.items.find(
      (row) => row.param === "fszn.employee-rate" && row.status === "pending",
    );
    const confirm = await stack.call("local", "/admin/rates/confirm", {
      cookie: root,
      body: { id: pending?.id },
    });
    expect(confirm.status).toBe(200);

    const estimated = await calc(user.cookie, input);
    expect(estimated.income?.amount).toEqual({ minor: 290_698, currency: "BYN" });
    expect(estimated.term).toMatchObject({ months: 41, approx: true });
    expect(estimated.flags).toEqual(["income-estimated", "ask-gross"]);
  });

  it("ответ на вопрос TAX-04 сохраняется фактом income.gross и подхватывается следующим расчётом (PROF-04)", async () => {
    const user = await registerUser(stack, db, "housing-gross@example.test");
    await setFact(user.cookie, { key: "income.gross", amount: byn(2500) });
    const result = await calc(user.cookie, { kind: "housing", expenses: byn(120_000) });
    expect(result.term).toMatchObject({ months: 48, approx: false });
    expect(result.flags).toEqual([]);
  });
});

describe("TAX-02: только НПД", () => {
  it("вычет не считается и объясняется — ни суммы, ни срока", async () => {
    const user = await registerUser(stack, db, "npd@example.test");
    await setFact(user.cookie, { key: "employment", types: ["npd"] });
    const result = await calc(user.cookie, { kind: "education", paid: byn(2000) });
    expect(result).toMatchObject({ status: "not-applicable", reason: "npd-only" });
    expect(result.savingTotal).toBeNull();
  });
});
