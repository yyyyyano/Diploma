// Счета (STMT-01, STMT-02, STMT-09, RCPT-10, P5, AGT-07): список с остатками, датой остатка и итогами в BYN по курсу
// НБРБ; создать, переименовать, задать начальный остаток — сразу и с «Отменить» (ревизия «до действия», в журнале —
// её id); удалить — только через ожидающее решение «Да/Нет» в actions. Курсы запрашиваются до транзакций (HTTP вне
// транзакции); курса нет — эквивалент и итог не показываются, а не считаются нулём. Фасад для transactions и statements:
// найти или создать карту банка, применить изменение остатка, «Наличные» и «Карта, не указана».
import { node, sum, type Calc, type FxRateInput } from "@kosht/calc";
import {
  AccountId,
  type AccountListItem,
  type AccountList,
  type CreateAccountInput,
  type ExplainSubject,
} from "@kosht/contract";
import { LocalDate, Money, type TraceId } from "@kosht/kernel";
import type { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { Platform } from "../../../platform/module/define-module.ts";
import type { ActionsFacade } from "../../actions/index.ts";
import type { ExplainFacade } from "../../explain/index.ts";
import type { FxRate, FxRatesFacade } from "../../fx-rates/index.ts";
import {
  balanceCalc,
  balanceInByn,
  isProtected,
  isSavings,
  shiftBalance,
  totalInByn,
} from "../domain/accounts.ts";
import { balancesChanged } from "../events.ts";
import {
  createCashIfMissing,
  createUnknownCardIfMissing,
  deleteAccount,
  findByBankMask,
  findByMask,
  findRevision,
  findService,
  insertAccount,
  insertRevision,
  listAccounts,
  lockAccount,
  updateAccount,
  type AccountRow,
} from "../infrastructure/db/accounts.repo.ts";

export const RESTORE_HANDLER = "accounts.restore";
export const DELETE_HANDLER = "accounts.delete";

/** Остатки счетов в BYN для расчётов fin (FIN-22). */
export interface AccountBalances {
  readonly onDate: LocalDate;
  readonly items: readonly {
    readonly id: string;
    readonly kind: string;
    readonly currency: string;
    readonly balance: Money;
    /** Эквивалент в BYN с трассой; нет курса — `null` (счёт помечен, не 0). */
    readonly inByn: Calc<Money> | null;
  }[];
  /** Сумма эквивалентов счетов без накопительных; счета без курса в неё не входят. */
  readonly available: Calc<Money>;
  readonly unconverted: readonly string[];
  readonly missingRates: readonly string[];
}

export type Channel = "web" | "telegram";

/** Поправка остатка по выписке (STMT-02) и день с источником до неё: по ним откат импорта возвращает состояние (STMT-11). */
export interface BalanceAdjustment {
  readonly adjustmentMinor: number;
  readonly balanceOn: string;
  readonly balanceSource: string;
}

export interface AccountsDeps {
  readonly platform: Pick<Platform, "clock" | "events" | "realtime" | "log">;
  readonly actions: Pick<ActionsFacade, "record" | "propose">;
  readonly fxRates: Pick<FxRatesFacade, "rateOn">;
  readonly explain: Pick<ExplainFacade, "save">;
}

function rateInput(rate: FxRate): FxRateInput {
  return { currency: rate.currency, rateE4: rate.rateE4, scale: rate.scale, id: rate.id };
}

function toItem(row: AccountRow, rate: FxRate | undefined): AccountListItem {
  const inByn = row.currency === "BYN" ? undefined : balanceInByn(row, rate && rateInput(rate));
  return {
    id: AccountId.parse(row.id),
    kind: row.kind as AccountListItem["kind"],
    name: row.name,
    bank: row.bank,
    mask: row.mask,
    balance: Money.of(row.balanceMinor, row.currency),
    balanceOn: LocalDate.parse(row.balanceOn),
    balanceSource: row.balanceSource as AccountListItem["balanceSource"],
    initialBalance: Money.of(row.initialBalanceMinor, row.currency),
    balanceInByn: inByn?.value ?? null,
    rate:
      rate === undefined || row.currency === "BYN"
        ? null
        : { rateE4: rate.rateE4, scale: rate.scale, date: LocalDate.parse(rate.rateDate) },
  };
}

/** Подпись счёта для вопроса «Удалить счёт …?»: своё название или банк и маска (данные человека, не текст сайта). */
function subjectName(row: AccountRow): string {
  if (row.name !== null) return row.name;
  const parts = [row.bank, row.mask === null ? null : `•• ${row.mask}`].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(" ") : row.currency;
}

export function makeAccounts(d: AccountsDeps) {
  const { clock, events, realtime, log } = d.platform;

  /** Курсы НБРБ на сегодня по валютам счетов (не BYN) — до транзакций; нет курса — валюты нет в карте. */
  async function ratesFor(rows: readonly AccountRow[]): Promise<Map<string, FxRate>> {
    const today = clock.today();
    const currencies = [...new Set(rows.map((row) => row.currency))].filter((c) => c !== "BYN");
    const rates = new Map<string, FxRate>();
    for (const currency of currencies) {
      const rate = await d.fxRates.rateOn(currency, today);
      if (rate !== undefined) rates.set(currency, rate);
    }
    return rates;
  }

  async function changed(tx: ScopedDb, ids: readonly string[], balances: boolean): Promise<void> {
    if (balances) await events.publish(tx, balancesChanged, { ids: [...ids] });
    await realtime.changed(tx, { entity: "account", ids: [...ids] });
  }

  async function lockOwn(tx: ScopedDb, id: string): Promise<AccountRow> {
    const row = await lockAccount(tx, id);
    if (row === undefined) throw new AppError("NOT_FOUND");
    return row;
  }

  async function itemOf(s: ScopedDb, id: string): Promise<AccountListItem> {
    const row = await lockAccount(s, id);
    if (row === undefined) throw new AppError("NOT_FOUND");
    const rates = await ratesFor([row]);
    return toItem(row, rates.get(row.currency));
  }

  /** STMT-01, STMT-02, STMT-09: счета с остатками и итоги в BYN по курсу НБРБ на сегодня. */
  async function list(s: ScopedDb): Promise<AccountList> {
    const rows = await listAccounts(s);
    const rates = await ratesFor(rows);
    const inputs = new Map([...rates].map(([currency, rate]) => [currency, rateInput(rate)]));
    const total = totalInByn("accounts.total", rows, inputs);
    const available = totalInByn(
      "accounts.available",
      rows.filter((row) => !isSavings(row.kind)),
      inputs,
    );
    return {
      onDate: clock.today(),
      items: rows.map((row) => toItem(row, rates.get(row.currency))),
      totals: {
        total: total?.value ?? null,
        available: available?.value ?? null,
        missingRates: [...new Set(rows.map((row) => row.currency))].filter(
          (currency) => currency !== "BYN" && !rates.has(currency),
        ),
      },
    };
  }

  /**
   * Фасад для `fin` (FIN-22): остатки в BYN как расчёты. «Доступно» — без накопительных счетов; счёт, у которого нет курса
   * НБРБ, не считается нулём: он в `unconverted`, его валюта — в `missingRates`, а в сумму не входит.
   */
  async function balances(s: ScopedDb): Promise<AccountBalances> {
    const rows = await listAccounts(s);
    const rates = await ratesFor(rows);
    const inputs = new Map([...rates].map(([currency, rate]) => [currency, rateInput(rate)]));
    const items = rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      currency: row.currency,
      balance: Money.of(row.balanceMinor, row.currency),
      inByn: balanceInByn(row, inputs.get(row.currency)) ?? null,
    }));
    const spendable = items.filter((item) => !isSavings(item.kind));
    const converted = spendable.flatMap((item) => (item.inByn === null ? [] : [item.inByn]));
    const [first, ...rest] = converted;
    return {
      onDate: clock.today(),
      items,
      available:
        first === undefined
          ? node("accounts.available", Money.of(0, "BYN"))
          : sum("accounts.available", [first, ...rest]),
      unconverted: items.filter((item) => item.inByn === null).map((item) => item.id),
      missingRates: [...new Set(items.filter((i) => i.inByn === null).map((i) => i.currency))],
    };
  }

  /**
   * «Откуда эта цифра?» (EXPL-01): тот же расчёт, что у списка (курс — из кэша на сегодня), сохраняется в explain и
   * отдаётся его traceId. Сохраняется по запросу человека, а не при каждом открытии экрана. Курса нет — UNAVAILABLE.
   */
  async function explain(s: ScopedDb, subject: z.infer<typeof ExplainSubject>): Promise<TraceId> {
    const rows =
      subject.kind === "account" ? [await itemRow(s, subject.id)] : await listAccounts(s);
    const rates = await ratesFor(rows);
    const inputs = new Map([...rates].map(([currency, rate]) => [currency, rateInput(rate)]));
    const today = clock.today();
    if (subject.kind === "account") {
      const [row] = rows;
      if (row === undefined) throw new AppError("NOT_FOUND");
      const calc =
        row.currency === "BYN" ? balanceCalc(row) : balanceInByn(row, inputs.get(row.currency));
      if (calc === undefined) throw new AppError("UNAVAILABLE");
      const rate = rates.get(row.currency);
      const day = rate === undefined ? today : LocalDate.parse(rate.rateDate);
      return d.explain.save(s, calc, { period: { from: day, to: day } });
    }
    const chosen = subject.kind === "available" ? rows.filter((row) => !isSavings(row.kind)) : rows;
    const calc = totalInByn(`accounts.${subject.kind}`, chosen, inputs);
    if (calc === undefined) throw new AppError("UNAVAILABLE");
    return d.explain.save(s, calc, { period: { from: today, to: today } });
  }

  async function itemRow(s: ScopedDb, id: string): Promise<AccountRow> {
    const row = await lockAccount(s, id);
    if (row === undefined) throw new AppError("NOT_FOUND");
    return row;
  }

  async function record(
    tx: ScopedDb,
    accountId: string,
    revisionId: string,
    channel: Channel,
  ): Promise<string> {
    return d.actions.record(tx, {
      handler: RESTORE_HANDLER,
      payload: { revisionId },
      subject: `account:${accountId}`,
      channel,
    });
  }

  /** STMT-01: новый счёт вручную; такой же (банк, маска, валюта) или вторые «Наличные» в BYN — CONFLICT. */
  async function create(
    s: ScopedDb,
    input: z.output<typeof CreateAccountInput>,
    channel: Channel,
  ): Promise<{ account: AccountListItem; undoToken: string }> {
    if (input.initialBalance !== null && input.initialBalance.currency !== input.currency) {
      throw new AppError("VALIDATION");
    }
    const initial = input.initialBalance?.minor ?? 0;
    const { id, undoToken } = await s.transaction(async (tx) => {
      const created = await insertAccount(tx, {
        kind: input.kind,
        name: input.name,
        bank: input.bank,
        mask: input.mask,
        currency: input.currency,
        initialBalanceMinor: initial,
        balanceMinor: initial,
        balanceOn: clock.today(),
        balanceSource: "manual",
      });
      if (created === undefined) throw new AppError("CONFLICT");
      const revisionId = await insertRevision(tx, {
        accountId: created,
        existed: false,
        name: input.name,
        initialBalanceMinor: initial,
      });
      const token = await record(tx, created, revisionId, channel);
      await changed(tx, [created], true);
      return { id: created, undoToken: token };
    });
    log.info({ accountId: id }, "accounts.created");
    return { account: await itemOf(s, id), undoToken };
  }

  async function rename(
    s: ScopedDb,
    input: { id: string; name: string },
    channel: Channel,
  ): Promise<{ account: AccountListItem; undoToken: string }> {
    const undoToken = await s.transaction(async (tx) => {
      const row = await lockOwn(tx, input.id);
      const revisionId = await insertRevision(tx, {
        accountId: row.id,
        existed: true,
        name: row.name,
        initialBalanceMinor: row.initialBalanceMinor,
      });
      await updateAccount(tx, row.id, { name: input.name }, clock.now());
      const token = await record(tx, row.id, revisionId, channel);
      await changed(tx, [row.id], false);
      return token;
    });
    return { account: await itemOf(s, input.id), undoToken };
  }

  /** STMT-01: начальный остаток; остаток сдвигается на ту же разницу, валюта — валюта счёта. */
  async function setInitialBalance(
    s: ScopedDb,
    input: { id: string; initialBalance: Money },
    channel: Channel,
  ): Promise<{ account: AccountListItem; undoToken: string }> {
    const undoToken = await s.transaction(async (tx) => {
      const row = await lockOwn(tx, input.id);
      if (row.currency !== input.initialBalance.currency) throw new AppError("VALIDATION");
      const revisionId = await insertRevision(tx, {
        accountId: row.id,
        existed: true,
        name: row.name,
        initialBalanceMinor: row.initialBalanceMinor,
      });
      await applyInitial(tx, row, input.initialBalance.minor);
      const token = await record(tx, row.id, revisionId, channel);
      await changed(tx, [row.id], true);
      return token;
    });
    return { account: await itemOf(s, input.id), undoToken };
  }

  async function applyInitial(tx: ScopedDb, row: AccountRow, initialMinor: number): Promise<void> {
    const balance = shiftBalance(
      Money.of(row.balanceMinor, row.currency),
      Money.of(row.initialBalanceMinor, row.currency),
      Money.of(initialMinor, row.currency),
    );
    await updateAccount(
      tx,
      row.id,
      { initialBalanceMinor: initialMinor, balanceMinor: balance.minor },
      clock.now(),
    );
  }

  /** AGT-07: удаление — только ожидающее решение; служебные счета — ACCOUNT_PROTECTED. */
  async function requestDelete(s: ScopedDb, id: string): Promise<string> {
    const row = await itemRow(s, id);
    if (isProtected(row)) throw new AppError("ACCOUNT_PROTECTED");
    return d.actions.propose(s, {
      handler: DELETE_HANDLER,
      payload: { accountId: row.id },
      summary: { key: "decisions.accountDelete", params: { name: subjectName(row) } },
    });
  }

  /** «Да» (реестр confirm): удалить счёт; уже удалён — ничего; служебный — ACCOUNT_PROTECTED. */
  async function confirmDelete(tx: ScopedDb, payload: unknown): Promise<void> {
    const accountId = (payload as { accountId?: unknown } | null)?.accountId;
    if (typeof accountId !== "string") throw new Error("accounts.delete: нет accountId в решении.");
    const row = await lockAccount(tx, accountId);
    if (row === undefined) return;
    if (isProtected(row)) throw new AppError("ACCOUNT_PROTECTED");
    // STMT-01: счёт с операциями не удаляется — их FK RESTRICT (миграция transactions).
    if (!(await deleteAccount(tx, row.id))) {
      throw new AppError("CONFLICT", { reason: "account-has-transactions" });
    }
    await changed(tx, [row.id], true);
    log.info({ accountId: row.id }, "accounts.deleted");
  }

  /** «Отменить» (реестр undo): счёт снова такой, каким был до действия; созданный — удаляется. */
  async function restore(tx: ScopedDb, payload: unknown): Promise<void> {
    const revisionId = (payload as { revisionId?: unknown } | null)?.revisionId;
    const revision =
      typeof revisionId === "string" ? await findRevision(tx, revisionId) : undefined;
    if (revision === undefined) throw new Error("accounts.restore: нет ревизии из журнала.");
    const row = await lockAccount(tx, revision.accountId);
    if (row === undefined) return;
    if (!revision.existed) {
      // Созданный счёт уже с операциями — «Отменить» его не удаляет (STMT-01).
      if (!(await deleteAccount(tx, row.id))) throw new AppError("CONFLICT");
    } else {
      await updateAccount(tx, row.id, { name: revision.name }, clock.now());
      await applyInitial(tx, row, revision.initialBalanceMinor);
    }
    await changed(tx, [row.id], true);
  }

  /** Фасад (statements, transactions): карта банка по маске и валюте; нет — создаётся (STMT-01). */
  async function findOrCreate(
    tx: ScopedDb,
    key: { bank: string; mask: string; currency: string },
  ): Promise<AccountId> {
    const found = await findByBankMask(tx, key);
    if (found !== undefined) return AccountId.parse(found);
    const created = await insertAccount(tx, {
      kind: "card",
      name: null,
      bank: key.bank,
      mask: key.mask,
      currency: key.currency,
      initialBalanceMinor: 0,
      balanceMinor: 0,
      balanceOn: clock.today(),
      balanceSource: "operations",
    });
    if (created !== undefined) {
      await changed(tx, [created], false);
      return AccountId.parse(created);
    }
    // Ту же карту создали параллельно.
    const again = await findByBankMask(tx, key);
    if (again === undefined) throw new Error("accounts: карта пропала после вставки.");
    return AccountId.parse(again);
  }

  /** Фасад (transactions, STMT-02): остаток += изменение (валюта счёта), день остатка — не раньше прежнего. */
  async function applyBalanceChange(
    tx: ScopedDb,
    change: { accountId: string; delta: Money; on: LocalDate },
  ): Promise<void> {
    const row = await lockOwn(tx, change.accountId);
    if (row.currency !== change.delta.currency) {
      throw new RangeError("Изменение остатка — в валюте счёта.");
    }
    const balance = shiftBalance(
      Money.of(row.balanceMinor, row.currency),
      Money.of(0, row.currency),
      change.delta,
    );
    await updateAccount(
      tx,
      row.id,
      {
        balanceMinor: balance.minor,
        balanceOn: change.on > row.balanceOn ? change.on : row.balanceOn,
        balanceSource: "operations",
      },
      clock.now(),
    );
    await changed(tx, [row.id], true);
  }

  /** Фасад (statements, STMT-01): карта банка без создания — для предпросмотра, где счёта может ещё не быть. */
  async function findCard(
    s: ScopedDb,
    key: { bank: string; mask: string; currency: string },
  ): Promise<AccountId | undefined> {
    const id = await findByBankMask(s, key);
    return id === undefined ? undefined : AccountId.parse(id);
  }

  /** Фасад (transactions, RCPT-10): карта по последним цифрам чека; нет или несколько — undefined (тогда «Карта, не указана»). */
  async function findCardByMask(
    s: ScopedDb,
    key: { mask: string; currency: string },
  ): Promise<AccountId | undefined> {
    const id = await findByMask(s, key);
    return id === undefined ? undefined : AccountId.parse(id);
  }

  /**
   * Фасад (statements, STMT-02): остаток из выписки на день `on` — абсолютный, а не сдвиг. Выписка старше уже известного
   * остатка его не перебивает (`undefined`), если не `force` (счёт создан этим же импортом: остатка «новее» у него нет, а
   * день создания — сегодняшний). Возвращает поправку (выписка − остаток до неё) и день с источником «до»: по ним откат
   * импорта убирает ровно эту поправку, не затирая операции, внесённые позже.
   */
  async function setStatementBalance(
    tx: ScopedDb,
    change: { accountId: string; balance: Money; on: LocalDate; force?: boolean },
  ): Promise<BalanceAdjustment | undefined> {
    const row = await lockOwn(tx, change.accountId);
    if (row.currency !== change.balance.currency) {
      throw new RangeError("Остаток выписки — в валюте счёта.");
    }
    if (change.force !== true && change.on < row.balanceOn) return undefined;
    await updateAccount(
      tx,
      row.id,
      { balanceMinor: change.balance.minor, balanceOn: change.on, balanceSource: "statement" },
      clock.now(),
    );
    await changed(tx, [row.id], true);
    return {
      adjustmentMinor: change.balance.minor - row.balanceMinor,
      balanceOn: row.balanceOn,
      balanceSource: row.balanceSource,
    };
  }

  /** Фасад (statements, STMT-11): убрать поправку выписки; день и источник остатка — как до импорта. */
  async function revertStatementBalance(
    tx: ScopedDb,
    accountId: string,
    adjustment: BalanceAdjustment,
  ): Promise<void> {
    const row = await lockOwn(tx, accountId);
    await updateAccount(
      tx,
      row.id,
      {
        balanceMinor: row.balanceMinor - adjustment.adjustmentMinor,
        balanceOn: adjustment.balanceOn,
        balanceSource: adjustment.balanceSource,
      },
      clock.now(),
    );
    await changed(tx, [row.id], true);
  }

  /** Фасад (transactions): валюта своего счёта — операция пишется в валюте счёта; чужой или нет — NOT_FOUND. */
  async function currencyOf(s: ScopedDb, id: string): Promise<string> {
    return (await itemRow(s, id)).currency;
  }

  /** Фасад: «Наличные» в BYN пользователя (STMT-01) — есть всегда, создаются, если подписка ещё не успела. */
  async function cash(tx: ScopedDb): Promise<AccountId> {
    const created = await createCashIfMissing(tx, clock.today());
    if (created.length > 0) await changed(tx, created, false);
    const id = await findService(tx, "cash");
    if (id === undefined) throw new Error("accounts: «Наличные» не найдены после создания.");
    return AccountId.parse(id);
  }

  /** Фасад (RCPT-10): «Карта, не указана» — создаётся при первом обращении, а не у всех сразу. */
  async function unknownCard(tx: ScopedDb): Promise<AccountId> {
    const created = await createUnknownCardIfMissing(tx, clock.today());
    if (created.length > 0) await changed(tx, created, false);
    const id = await findService(tx, "unknown-card");
    if (id === undefined)
      throw new Error("accounts: «Карта, не указана» не найдена после создания.");
    return AccountId.parse(id);
  }

  return {
    list,
    balances,
    explain,
    create,
    rename,
    setInitialBalance,
    requestDelete,
    confirmDelete,
    restore,
    findOrCreate,
    findCard,
    findCardByMask,
    setStatementBalance,
    revertStatementBalance,
    applyBalanceChange,
    currencyOf,
    cash,
    unknownCard,
  };
}

export type Accounts = ReturnType<typeof makeAccounts>;
