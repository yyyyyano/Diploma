// LEGAL-03, LEGAL-09, CHAT-05, P3: правовые сценарии агента на настоящей базе законов (сохранённые страницы pravo.by: 90-З,
// НК; без сети) и настоящих инструментах — поиск по базе, калькулятор, чек-лист, `finalizeAnswer`. Модель — скриптованная:
// живая запись этих сценариев невозможна на бесплатных тарифах (правовой запрос — префикс набора `legal` и 6–10 фрагментов
// законов в результате поиска — не помещается в 8 000 токенов в минуту у Groq, Z.ai отвечает по таймауту, локальная модель
// не скачана); живое поведение модели — на кассетах `run-agent.cassette.agent.int.test.ts`. Здесь доказано то, что от модели
// не зависит: цитата в ответе — только текст версии из базы, срок считает код, чек-лист — готовый шаблон, чисел вне
// результатов инструментов нет.
import { LawAnswerData } from "@kosht/contract";
import { LocalDate, makeScope } from "@kosht/kernel";
import { testScope } from "@kosht/testing";
import { createTestDb, type TestDb } from "@kosht/testing/db";
import type { UIMessage } from "ai";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { waitForAppConnectionsClosed } from "../../../main/__fixtures__/compose-on-test-db.ts";
import {
  STACK_PASSWORD,
  startHttpStack,
  type HttpStack,
} from "../../../main/__fixtures__/http-stack.ts";
import { memoryLogger } from "../../../platform/logging/__fixtures__/memory-logger.ts";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import type { LegalConsultFacade } from "../../legal-consult/index.ts";
import type { ProfileFacade } from "../../profile/index.ts";
import { fakeLlm } from "../__fixtures__/fake-llm.ts";
import { scriptedModel, type ScriptStep } from "../__fixtures__/scripted-model.ts";
import { makeRunAgent } from "./run-agent.ts";

const PRAVO = fileURLToPath(new URL("../../legal-base/__fixtures__/pravo-by", import.meta.url));
/** 90-З «О защите прав потребителей»: срок обмена товара надлежащего качества — ст. 28. */
const CONSUMER_ACT = "H10200090";

let db: TestDb;
let stack: HttpStack;
let pages: string;
let household = 800;

beforeAll(async () => {
  db = await createTestDb();
  pages = await mkdtemp(join(tmpdir(), "kosht-pravo-"));
  await cp(PRAVO, pages, { recursive: true });
  stack = await startHttpStack(db, {
    env: { LLM_MODE: "live", LEGAL_SOURCE: "fixtures", LEGAL_FIXTURES_DIR: pages },
  });
  const setup = await stack.call("local", "/identity/setup", {
    body: { email: "root@example.test", password: STACK_PASSWORD },
  });
  if (setup.status !== 200) throw new Error(`первый запуск не прошёл: ${String(setup.status)}`);
  await vi.waitFor(
    async () => {
      const response = await stack.call("local", "/legal-base/startup-progress");
      const progress = (await response.json()) as { state: string };
      if (progress.state !== "ready") throw new Error("каталог законов ещё загружается");
    },
    { timeout: 60_000, interval: 300 },
  );
});
afterAll(async () => {
  await stack.close();
  await waitForAppConnectionsClosed(db);
  await db.drop();
  await rm(pages, { recursive: true, force: true });
});

const platform = () => stack.api.platform;
const facade = <F>(id: string): F => {
  const module = stack.api.modules.find((m) => m.id === id);
  if (module === undefined) throw new Error(`нет модуля ${id}`);
  return module.facade as F;
};

function newUser(): { s: ScopedDb } {
  household += 1;
  return { s: platform().scoped(makeScope(testScope({ user: household, household }))) };
}

/** Вызов настоящего инструмента реестра — так тест узнаёт id версий базы, не зная их заранее. */
async function callTool(s: ScopedDb, name: string, input: object): Promise<unknown> {
  const def = platform()
    .tools()
    .find((tool) => tool.name === name);
  if (def === undefined || def.kind === "destructive") throw new Error(`нет инструмента ${name}`);
  return def.execute({ s, requestId: "seed", channel: "web" }, def.input.parse(input));
}

interface Found {
  readonly id: string;
  readonly actId: string;
  readonly path: string;
  readonly text: string;
}

/** Запрос поиска, который модель в сценариях отправляет инструменту (тот же, что у теста: метка должна быть среди найденного). */
const EXCHANGE_QUERY = "обмен непродовольственного товара надлежащего качества четырнадцать дней";

/** Фрагмент закона о защите прав потребителей, в котором назван срок обмена (14 дней), — по настоящему поиску. */
async function exchangeTerm(s: ScopedDb): Promise<Found> {
  const found = (await callTool(s, "search_law", { query: EXCHANGE_QUERY })) as {
    fragments: Found[];
  };
  const fragment = found.fragments.find(
    (item) => item.actId === CONSUMER_ACT && /четырнадцат/iu.test(item.text),
  );
  if (fragment === undefined) throw new Error("поиск не нашёл норму о сроке обмена в 90-З");
  return fragment;
}

/** Цитата — фраза нормы без знаков конца предложения и без чисел (проверка чисел режет черновик по предложениям). */
function quoteOf(text: string): string {
  const phrase = /Потребитель вправе в течение четырнадцати дней[^,.]*/u.exec(flat(text));
  if (phrase === null) throw new Error("в норме нет ожидаемой фразы о сроке обмена");
  return phrase[0];
}

const flat = (text: string): string => text.replace(/\s+/gu, " ").trim();

async function ask(
  s: ScopedDb,
  question: string,
  script: readonly ScriptStep[],
): Promise<{ message: UIMessage; log: Record<string, unknown>[] }> {
  const memory = memoryLogger();
  const { llm } = fakeLlm(scriptedModel(script).model);
  let finished: UIMessage | undefined;
  const run = makeRunAgent({
    llm,
    actions: facade<ActionsFacade>("actions"),
    profile: facade<ProfileFacade>("profile"),
    legalConsult: facade<LegalConsultFacade>("legal-consult"),
    tools: () => platform().tools(),
    scoped: (scope) => platform().scoped(scope),
    log: memory.log,
    clock: platform().clock,
    maxSteps: async () => 8,
    historyMessages: async () => 12,
  });
  const stream = await run(s, {
    messages: [{ id: "q-1", role: "user", parts: [{ type: "text", text: question }] }],
    abortSignal: new AbortController().signal,
    requestId: "law-test",
    sessionId: "dialog-1",
    messageId: "m-1",
    metadata: { runId: "run-1" },
    onFinish: async (message) => {
      finished = message;
    },
  });
  for await (const chunk of stream) void chunk;
  if (finished === undefined) throw new Error("запуск не вызвал onFinish");
  return { message: finished, log: memory.lines() };
}

const toolParts = (message: UIMessage, name: string) =>
  message.parts.filter((part) => part.type === `tool-${name}`) as {
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
  }[];

function lawAnswerOf(message: UIMessage): LawAnswerData {
  const part = message.parts.find((candidate) => candidate.type === "data-law-answer") as
    | { data: unknown }
    | undefined;
  if (part === undefined) throw new Error("в ответе нет части data-law-answer");
  return LawAnswerData.parse(part.data);
}

/** Каждая цитата ответа — настоящий текст версии из базы (P3: недословной цитаты не бывает). */
async function expectQuotesFromBase(law: LawAnswerData): Promise<void> {
  const quotes = law.citations.filter((citation) => citation.kind === "quote");
  expect(quotes.length).toBeGreaterThanOrEqual(1);
  for (const quote of quotes) {
    const { rows } = await db.owner.query<{ body: string }>(
      "select body from legal_fragment_versions where id::text = $1",
      [quote.versionId],
    );
    expect(rows[0]).toBeDefined();
    expect(flat(rows[0]?.body ?? "")).toContain(flat(quote.text));
  }
}

const unverified = (log: Record<string, unknown>[]) =>
  log.some((line) => line["msg"] === "agent.number-unverified");

describe("LEGAL-03, CHAT-05: правовой вопрос — только дословные цитаты базы", () => {
  it("поиск → черновик с цитатой и меткой → в ответе текст версии из базы, дата редакции, ссылка pravo.by и «Не является юридической консультацией»", async () => {
    const { s } = newUser();
    const norm = await exchangeTerm(s);
    const question = "В какой срок можно обменять непродовольственный товар надлежащего качества?";
    const { message, log } = await ask(s, question, [
      { tools: [{ name: "search_law", input: { query: EXCHANGE_QUERY } }] },
      { text: `Срок обмена назван в законе. «${quoteOf(norm.text)}» [[F${norm.id}]]` },
    ]);
    expect(toolParts(message, "search_law")).toHaveLength(1);
    const law = lawAnswerOf(message);
    expect(law.outcome).toBe("cited");
    await expectQuotesFromBase(law);
    const quote = law.citations.find((citation) => citation.kind === "quote");
    expect(quote).toMatchObject({ pravoId: CONSUMER_ACT, versionId: norm.id });
    expect(quote?.kind === "quote" ? quote.edition : "").toMatch(/\d{2}\.\d{2}\.\d{4}/u);
    expect(quote?.kind === "quote" ? quote.url : "").toMatch(/^https:\/\/pravo\.by\//u);
    expect(law.notices.at(-1)?.kind).toBe("disclaimer");
    expect(law.versionIds).toContain(norm.id);
    expect(unverified(log)).toBe(false);
  });

  it("модель исказила цитату (подменила слово) — искажённый текст в ответ не попадает: цитата заменена ссылкой с пометкой", async () => {
    const { s } = newUser();
    const norm = await exchangeTerm(s);
    const forged = quoteOf(norm.text).replace(/четырнадцат\p{L}*/iu, "тридцати");
    const { message } = await ask(s, "Срок обмена товара по закону?", [
      { tools: [{ name: "search_law", input: { query: EXCHANGE_QUERY } }] },
      { text: `Срок обмена: «${forged}» [[F${norm.id}]]` },
    ]);
    const law = lawAnswerOf(message);
    expect(JSON.stringify(law)).not.toContain("тридцати");
    // Цитата не прошла проверку: вместо неё ссылка с пометкой (LEGAL-03) или настоящий текст версии — но не выдумка модели.
    expect(law.citations.length).toBeGreaterThanOrEqual(1);
    const quotes = law.citations.filter((citation) => citation.kind === "quote");
    const links = law.citations.filter((citation) => citation.kind === "link");
    expect(quotes.every((quote) => flat(norm.text).includes(flat(quote.text)))).toBe(true);
    expect(links.every((link) => link.reason === "quote-unverified")).toBe(true);
  });
});

/** Чек пылесоса: строка в `receipts` и связь с операцией — как после распознавания (RCPT-10). */
async function seedVacuumPurchase(s: ScopedDb, day: string): Promise<string> {
  const added = (await callTool(s, "add_transaction", {
    type: "expense",
    amountMinor: 25_000,
    date: day,
    merchant: "Пылесос",
  })) as { transaction: { id: string } };
  const { rows } = await db.owner.query<{ id: string }>(
    `insert into receipts (household_id, user_id, file_id, status, store_name, purchase_date, total_minor)
     values ($1, $2, uuidv7(), 'ok', 'Электросила', $3, 25000) returning id`,
    [s.scope.householdId, s.scope.userId, day],
  );
  await db.owner.query(
    "update transactions set receipt_id = $1 where household_id = $2 and id = $3",
    [rows[0]?.id, s.scope.householdId, added.transaction.id],
  );
  return added.transaction.id;
}

describe("LEGAL-09: «купил пылесос 10 дней назад, хочу вернуть»", () => {
  it("покупка с чеком найдена, срок считает калькулятор (дата + 14 дней), чек-лист возврата — шаблон; ответ — цитата из базы", async () => {
    const { s } = newUser();
    const today = platform().clock.today();
    const boughtOn = LocalDate.addDays(today, -10);
    const purchase = await seedVacuumPurchase(s, boughtOn);
    const norm = await exchangeTerm(s);
    const question = "Купил пылесос 10 дней назад, хочу вернуть";
    const { message, log } = await ask(s, question, [
      {
        tools: [
          { name: "search_transactions", input: { query: "пылесос" } },
          { name: "search_law", input: { query: EXCHANGE_QUERY } },
        ],
      },
      {
        tools: [
          { name: "calculator", input: { op: "add_days", date: boughtOn, days: 14 } },
          { name: "get_checklist", input: { id: "return-good-quality" } },
        ],
      },
      { text: `Срок на обмен ещё идёт. «${quoteOf(norm.text)}» [[F${norm.id}]]` },
    ]);
    const found = toolParts(message, "search_transactions")[0]?.output as {
      items: { id: string; receiptId: string | null }[];
    };
    expect(found.items.find((item) => item.id === purchase)?.receiptId).not.toBeNull();
    const term = toolParts(message, "calculator")[0]?.output;
    expect(term).toMatchObject({ kind: "date", date: LocalDate.addDays(today, 4) });
    expect(term?.["traceId"]).toBeDefined();
    const checklist = toolParts(message, "get_checklist")[0]?.output;
    expect(checklist).toMatchObject({ id: "return-good-quality" });
    await expectQuotesFromBase(lawAnswerOf(message));
    expect(unverified(log)).toBe(false);
  });
});
