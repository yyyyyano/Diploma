// Чтение операций (TXN-01, TXN-02, TXN-05, STMT-09): страница с фильтрами, карточка с историей и курсом, «Откуда
// курс?». Суммы здесь не считаются: эквивалент в BYN записан при сохранении (код @kosht/calc), «Откуда курс?»
// пересчитывает тот же расчёт и сохраняет трассу.
import {
  SYSTEM_CATEGORIES,
  type TransactionCard,
  type TransactionList,
  type TransactionListInput,
} from "@kosht/contract";
import { createT } from "@kosht/i18n";
import { LocalDate, Money, type TraceId } from "@kosht/kernel";
import type { z } from "zod";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import {
  findMany,
  listPage,
  listRevisions,
  type ListFilter,
  type TransactionRow,
} from "../infrastructure/db/transactions.repo.ts";
import type { Deps, Parts } from "./deps.ts";
import { toDto } from "./mapping.ts";

const t = createT();

export function makeRead(d: Deps, parts: Parts) {
  /** Поиск «по категории»: коды встроенных и id своих, чьё название содержит текст. */
  async function matchedCategories(s: ScopedDb, text: string) {
    const needle = text.toLowerCase();
    const codes = SYSTEM_CATEGORIES.filter((category) =>
      t(`categories:system.${category.code}`).toLowerCase().includes(needle),
    ).map((category) => category.code);
    const ids = (await d.categories.list(s)).items.flatMap((item) =>
      item.ref.type === "custom" && (item.name ?? "").toLowerCase().includes(needle)
        ? [item.ref.id]
        : [],
    );
    return { codes, ids };
  }

  /** TXN-02: страница операций с фильтрами; сортировка — день, время, id (устойчиво). */
  async function list(
    s: ScopedDb,
    input: z.output<typeof TransactionListInput>,
  ): Promise<TransactionList> {
    const text = input.query === undefined || input.query === "" ? undefined : input.query;
    const matched = text === undefined ? undefined : await matchedCategories(s, text);
    const filter: ListFilter = {
      ...(text === undefined ? {} : { text }),
      ...(matched === undefined
        ? {}
        : { matchedCategoryCodes: matched.codes, matchedCategoryIds: matched.ids }),
      ...(input.from === undefined ? {} : { from: input.from }),
      ...(input.to === undefined ? {} : { to: input.to }),
      ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
      ...(input.categoryCode === undefined ? {} : { categoryCode: input.categoryCode }),
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(input.type === undefined ? {} : { type: input.type }),
      ...(input.amountFrom === undefined ? {} : { amountFromMinor: input.amountFrom }),
      ...(input.amountTo === undefined ? {} : { amountToMinor: input.amountTo }),
      ...(input.source === undefined ? {} : { source: input.source }),
      ...(input.hasReceipt === undefined ? {} : { hasReceipt: input.hasReceipt }),
      ...(input.needsReview === undefined ? {} : { needsReview: input.needsReview }),
    };
    const { rows, total } = await listPage(s, filter, input.page, input.pageSize);
    return { items: rows.map(toDto), page: input.page, pageSize: input.pageSize, total };
  }

  async function rowOf(s: ScopedDb, id: string): Promise<TransactionRow> {
    const [row] = await findMany(s, [id]);
    if (row === undefined) throw new AppError("NOT_FOUND");
    return row;
  }

  /** Курс, по которому посчитан эквивалент: тот же, что записан у операции (иначе — не показываем чужой). */
  async function rateOf(row: TransactionRow) {
    if (row.currency === "BYN" || row.fxRateId === null) return null;
    const rate = await d.fxRates.rateOn(row.currency, LocalDate.parse(row.occurredOn));
    if (rate === undefined || rate.id !== row.fxRateId) return null;
    return { rateE4: rate.rateE4, scale: rate.scale, date: LocalDate.parse(rate.rateDate) };
  }

  /** TXN-05: карточка — все поля, курс для валюты и история изменений. */
  async function get(s: ScopedDb, id: string): Promise<TransactionCard> {
    const row = await rowOf(s, id);
    const [rate, revisions] = await Promise.all([rateOf(row), listRevisions(s, id)]);
    return {
      transaction: toDto(row),
      rate,
      history: revisions.map((revision) => ({
        at: revision.createdAt.toISOString(),
        action: revision.action as TransactionCard["history"][number]["action"],
        channel: revision.channel as TransactionCard["history"][number]["channel"],
        fields: revision.fields as TransactionCard["history"][number]["fields"],
      })),
    };
  }

  /**
   * EXPL-01, STMT-09: тот же расчёт эквивалента в BYN (сумма × курс НБРБ на день операции), сохранённый в explain.
   * Курса нет или он уже не тот, что записан у операции, — UNAVAILABLE: «ровно тот расчёт» мы показать не можем.
   */
  async function explainRate(s: ScopedDb, id: string): Promise<TraceId> {
    const row = await rowOf(s, id);
    if (row.currency === "BYN" || row.amountBynMinor === null || row.fxRateId === null) {
      throw new AppError("UNAVAILABLE");
    }
    const day = LocalDate.parse(row.occurredOn);
    const calc = await parts.prepare.convertCalc(Money.of(row.amountMinor, row.currency), day);
    if (
      calc === undefined ||
      calc.rateId !== row.fxRateId ||
      calc.calc.value.minor !== row.amountBynMinor
    ) {
      throw new AppError("UNAVAILABLE");
    }
    return d.explain.save(s, calc.calc, { period: { from: day, to: day } });
  }

  return { list, get, explainRate };
}
