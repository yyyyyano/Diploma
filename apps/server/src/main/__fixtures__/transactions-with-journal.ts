// Сценарии операций на настоящих соседях: accounts (остаток), actions (журнал «Отменить», решения «Да/Нет»), explain,
// merchants и categories (справочник, правила, шлюз моделей — шпион) на Postgres с сидом миграций. Курсы НБРБ — карта в
// памяти (без сети, NFR-11), её можно «отключить»: НБРБ недоступен. События, сигналы сайту и поставленные задачи
// записываются в списки — тест проверяет, что ушло; задачи фона тест запускает сам (`background`).
import { toByn } from "@kosht/calc";
import { randomUUID } from "node:crypto";
import { FakeClock, testScope } from "@kosht/testing";
import { SystemCategoryCode } from "@kosht/contract";
import { LocalDate, Money } from "@kosht/kernel";
import type { TestDb } from "@kosht/testing/db";
import { createScopedCache } from "../../platform/cache/scoped-cache.ts";
import { createScopedDb, type ScopedDb } from "../../platform/db/scoped-db.ts";
import { createSystemDb } from "../../platform/db/system-db.ts";
import type { EventDef } from "../../platform/events/define-event.ts";
import type { JobDef } from "../../platform/jobs/define-job.ts";
import { memoryLogger } from "../../platform/logging/__fixtures__/memory-logger.ts";
import type { Platform, SystemPlatform } from "../../platform/module/define-module.ts";
import type { Realtime } from "../../platform/realtime/realtime.ts";
import {
  makeAccounts,
  DELETE_HANDLER as ACCOUNT_DELETE,
  RESTORE_HANDLER as ACCOUNT_RESTORE,
} from "../../modules/accounts/application/accounts.ts";
import { createActionsModule } from "../../modules/actions/index.ts";
import { makeCatalog } from "../../modules/categories/application/catalog.ts";
import { makeCategorize } from "../../modules/categories/application/categorize.ts";
import { createExplainModule } from "../../modules/explain/index.ts";
import type { FxRate } from "../../modules/fx-rates/index.ts";
import { createMerchantsModule } from "../../modules/merchants/index.ts";
import { DELETE_HANDLER } from "../../modules/transactions/application/remove.ts";
import { makeBase, makeOperations } from "../../modules/transactions/application/operations.ts";
import { fillRatesJob } from "../../modules/transactions/jobs/fill-rates.job.ts";
import { categorizeJob } from "../../modules/transactions/jobs/categorize.job.ts";
import { RESTORE_HANDLER } from "../../modules/transactions/application/write.ts";

/** Курс НБРБ как на проводе: BYN за `scale` единиц в десятитысячных. */
export type Rates = Readonly<Record<string, Omit<FxRate, "id" | "currency">>>;

export interface Enqueued {
  readonly name: string;
  readonly payload: unknown;
}

export const clock = new FakeClock("2026-10-28T09:00:00Z");

let household = 0;
/** ScopedDb нового домохозяйства (у каждого теста своё). */
export function newScope(db: TestDb): ScopedDb {
  household += 1;
  return createScopedDb(db.pool, testScope({ user: household, household }));
}

/**
 * Что отвечает шлюз моделей на классификацию: метки — «label» из подсказки; по умолчанию модель ничего не знает
 * (вся пачка уйдёт в «Прочее»). Вызовы записываются.
 */
export type ModelAnswer = (lines: string[]) => { line: number; label: string }[];

export function transactionsWithJournal(
  db: TestDb,
  options: { rates?: Rates; model?: ModelAnswer } = {},
) {
  const published: { name: string; ids: readonly string[] }[] = [];
  const signals: { entity: string; ids: readonly string[] }[] = [];
  const enqueued: Enqueued[] = [];
  const modelCalls: string[][] = [];
  let ratesUp = true;
  const rates = options.rates ?? {};
  const log = memoryLogger().log;
  const realtime: Realtime = {
    changed: async (_s, signal) => {
      signals.push({ entity: signal.entity, ids: signal.ids });
    },
    progress: async () => {},
  };
  const events = {
    publish: async (_tx: ScopedDb, event: EventDef, payload: { ids: readonly string[] }) => {
      published.push({ name: event.name, ids: payload.ids });
    },
  };
  const jobs = {
    enqueue: async (_tx: ScopedDb, job: JobDef, payload: unknown) => {
      enqueued.push({ name: job.name, payload });
    },
  };

  let ops: ReturnType<typeof makeOperations> | undefined;
  let accounts: ReturnType<typeof makeAccounts> | undefined;
  const ready = () => {
    if (ops === undefined || accounts === undefined) throw new Error("модули ещё не собраны");
    return { ops, accounts };
  };
  const platform = {
    clock,
    log,
    actionHandlers: () => ({
      undo: new Map([
        [RESTORE_HANDLER, (s: ScopedDb, p: unknown) => ready().ops.restore(s, p)],
        [ACCOUNT_RESTORE, (s: ScopedDb, p: unknown) => ready().accounts.restore(s, p)],
      ]),
      confirm: new Map<string, (s: ScopedDb, p: unknown) => Promise<string | undefined | void>>([
        [DELETE_HANDLER, (s: ScopedDb, p: unknown) => ready().ops.confirmDelete(s, p)],
        [ACCOUNT_DELETE, (s: ScopedDb, p: unknown) => ready().accounts.confirmDelete(s, p)],
      ]),
    }),
  } as unknown as Platform;
  const actions = createActionsModule({ platform, facades: {} }).facade;
  const explain = createExplainModule({ platform, facades: {} }).facade;

  const rateIds = new Map<string, string>();
  /** id курса валюты: у настоящего курса это uuid строки currency_rates (одна на валюту в тесте). */
  const rateId = (currency: string) => {
    const id = rateIds.get(currency) ?? randomUUID();
    rateIds.set(currency, id);
    return id;
  };
  const rateOn = async (currency: string, _day: LocalDate) => {
    const rate = rates[currency];
    if (!ratesUp || rate === undefined) return undefined;
    return { id: rateId(currency), currency, ...rate };
  };
  const fxRates = {
    rateOn,
    convert: async (key: string, amount: Parameters<typeof toByn>[1], day: LocalDate) => {
      if (amount.value.currency === "BYN") return { calc: amount, rate: null };
      const rate = await rateOn(amount.value.currency, day);
      if (rate === undefined) return undefined;
      return { calc: toByn(key, amount, rate), rate };
    },
  };
  accounts = makeAccounts({
    platform: { clock, log, realtime, events },
    actions,
    explain,
    fxRates,
  });

  const system = createSystemDb(db.pool);
  const settings = { get: async (def: { default: unknown }) => def.default as never };
  const merchants = createMerchantsModule({
    platform: { system, settings } as unknown as SystemPlatform,
    facades: {} as never,
  }).facade;
  const categorize = makeCategorize({
    system,
    merchants,
    llm: {
      extract: async (_caller: unknown, request: { document: string }) => {
        const lines = request.document.split("\n").map((line) => line.replace(/^\d+\. /, ""));
        modelCalls.push(lines);
        return { results: (options.model ?? (() => []))(lines) } as never;
      },
    } as never,
    settings,
    cache: createScopedCache<string>({ max: 100, ttlMs: 60_000, clock }),
    log,
  });
  const catalog = makeCatalog({ system, platform: { clock, realtime } });
  const categories = {
    byRules: categorize.byRules,
    categorize: categorize.categorize,
    list: catalog.list,
    setUserRule: catalog.setUserRule,
  };

  const deps = {
    platform: { clock, log, jobs, events, realtime },
    accounts,
    categories,
    merchants,
    fxRates,
    actions,
    explain,
  } as unknown as Parameters<typeof makeBase>[0];
  const base = makeBase(deps);
  const jobRefs = {
    fillRates: fillRatesJob(base.background.fillRates),
    categorize: categorizeJob(base.background.categorizeFallback),
  };
  ops = makeOperations(deps, base, jobRefs);

  return {
    ops,
    accounts,
    actions,
    explain,
    categories,
    background: base.background,
    published,
    signals,
    enqueued,
    modelCalls,
    rateId,
    /** НБРБ недоступен (false) или снова отвечает (true). */
    setRatesUp: (up: boolean) => {
      ratesUp = up;
    },
  };
}

type CreateInput = Parameters<ReturnType<typeof makeOperations>["create"]>[1];

/** Ввод операции для тестов: расход 6,50 BYN от 21.10 «Кофейня «Зерно»» в «Кафе»; поля — поверх. */
export function entry(over: Partial<CreateInput> = {}): CreateInput {
  return {
    type: "expense",
    occurredOn: LocalDate.parse("2026-10-21"),
    occurredTime: null,
    amount: Money.of(650, "BYN"),
    merchant: "Кофейня «Зерно»",
    note: null,
    category: { type: "system", code: SystemCategoryCode.parse("cafes") },
    ...over,
  };
}

/** Откуда пришло действие в тестах: сайт, вручную. */
export const WEB = { channel: "web", source: "manual" } as const;
