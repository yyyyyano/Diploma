// Предпросмотр импорта (STMT-04…STMT-09, CAT-06, ARCHITECTURE §11.2 шаг 3): из ParsedStatement — строки, какими они будут
// записаны: тип (STMT-08), контрагент (STMT-06), категория (правила, затем модель пачками — вне транзакции), эквивалент
// в BYN по курсу НБРБ на день операции (STMT-09), дубли (STMT-07), пары переводов и покупки возвратов. Всё, что ходит
// наружу (модель, НБРБ), — здесь, до транзакции импорта: матчинг и дубли модель в транзакции не зовут.
import { node } from "@kosht/calc";
import { LocalDate, Money } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import type { Settings } from "../../../platform/settings/settings.ts";
import type { AccountsFacade } from "../../accounts/index.ts";
import type { CategoriesFacade } from "../../categories/index.ts";
import type { FxRatesFacade } from "../../fx-rates/index.ts";
import type { MerchantsFacade } from "../../merchants/index.ts";
import type { TransactionsFacade } from "../../transactions/index.ts";
import {
  classifyRow,
  daysBetween,
  findCounterpart,
  findPurchase,
  withoutRefundWords,
  type Classified,
} from "../domain/classify.ts";
import { duplicateFlags, rowKeys } from "../domain/dedupe.ts";
import { summarize, type PreviewCounts } from "../domain/preview.ts";
import type { ParsedStatement } from "../domain/types.ts";
import type { PreviewRow } from "../infrastructure/db/schema.ts";
import { STATEMENTS_REFUND_WINDOW_DAYS, STATEMENTS_TRANSFER_WINDOW_DAYS } from "../settings.ts";

export interface PreviewDeps {
  readonly accounts: Pick<AccountsFacade, "findCard">;
  readonly transactions: Pick<
    TransactionsFacade,
    "knownKeys" | "transferCandidates" | "purchaseCandidates"
  >;
  readonly merchants: Pick<MerchantsFacade, "resolve">;
  readonly categories: Pick<CategoriesFacade, "categorize">;
  readonly fxRates: Pick<FxRatesFacade, "convert">;
  readonly settings: Pick<Settings, "get">;
}

/** Название банка, когда выписка его не назвала, но номер карты есть (счёт создаётся по банку + маске + валюте). */
export const UNKNOWN_BANK = "Банк не указан";

export interface Preview {
  readonly rows: readonly PreviewRow[];
  readonly counts: PreviewCounts;
  readonly accountExists: boolean;
}

/** Ключ счёта для дублей: стабилен и до создания счёта (банк без регистра, маска, валюта). */
export function accountKeyOf(parsed: ParsedStatement): string {
  return [
    (parsed.bank ?? UNKNOWN_BANK).toLowerCase(),
    parsed.accountMask ?? "",
    parsed.currency,
  ].join("|");
}

export function makeBuildPreview(d: PreviewDeps) {
  async function buildPreview(s: ScopedDb, parsed: ParsedStatement): Promise<Preview> {
    const currency = parsed.currency;
    const rows = parsed.rows;
    const accountId =
      parsed.accountMask === undefined
        ? undefined
        : await d.accounts.findCard(s, {
            bank: parsed.bank ?? UNKNOWN_BANK,
            mask: parsed.accountMask,
            currency,
          });
    const transferWindow = await d.settings.get(STATEMENTS_TRANSFER_WINDOW_DAYS);
    const refundWindow = await d.settings.get(STATEMENTS_REFUND_WINDOW_DAYS);

    // Тип и контрагент.
    const classified: Classified[] = rows.map((row) => classifyRow(row.description, row.amount));
    // У возврата слова «Возврат покупки» — не контрагент: ищем его по остатку описания (STMT-08).
    const merchants = await d.merchants.resolve(
      rows.map((row, index) =>
        classified[index]?.kind === "refund"
          ? withoutRefundWords(row.description)
          : row.description,
      ),
    );

    // Категории: смысл (зарплата, кредит) диктует тип; остальное — правила, затем модель пачками.
    const needs = rows.flatMap((_, index) => {
      const c = classified[index];
      if (c === undefined || c.kind === "transfer" || c.categoryCode !== undefined) return [];
      return [{ index, kind: c.kind === "expense" ? ("expense" as const) : ("income" as const) }];
    });
    const categorized = await d.categories.categorize(
      s,
      needs.map((need) => ({
        key: String(need.index),
        kind: need.kind,
        description: rows[need.index]?.description ?? "",
      })),
    );
    const categoryOf = new Map(categorized.map((item) => [Number(item.key), item]));

    // Дубли: ключи и идентификаторы против уже записанных операций выписок.
    const accountKey = accountKeyOf(parsed);
    const keys = rowKeys(
      accountKey,
      rows.map((row) => ({
        date: row.date,
        time: row.time,
        minor: row.amount.minor,
        currency: row.amount.currency,
        description: row.description,
        operationId: row.operationId,
      })),
    );
    const known = await d.transactions.knownKeys(s, {
      dedupeKeys: keys.map((key) => key.dedupeKey),
      externalIds: keys.flatMap((key) => key.externalId ?? []),
    });
    const duplicate = duplicateFlags(keys, known.dedupe, known.external);

    // Пары переводов и покупки возвратов.
    const dates = rows.map((row) => row.date).toSorted();
    const first = dates[0];
    const last = dates.at(-1);
    const shift = (day: string, by: number) => {
      const date = new Date(`${day}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + by);
      return date.toISOString().slice(0, 10);
    };
    const candidates =
      first === undefined || last === undefined
        ? []
        : await d.transactions.transferCandidates(s, {
            from: shift(first, -transferWindow),
            to: shift(last, transferWindow),
            excludeAccountIds: accountId === undefined ? [] : [accountId],
          });
    const refundKeys = [
      ...new Set(
        rows.flatMap((_, i) =>
          classified[i]?.kind === "refund"
            ? merchants[i]?.key === undefined || merchants[i]?.key === ""
              ? []
              : [merchants[i].key]
            : [],
        ),
      ),
    ];
    const purchases =
      first === undefined || last === undefined
        ? []
        : await d.transactions.purchaseCandidates(s, {
            merchantKeys: refundKeys,
            from: shift(first, -refundWindow),
            to: last,
          });

    const used = new Set<string>();
    const rates = new Map<string, { minor: number | null; rateId: string | null }>();
    const result: PreviewRow[] = [];
    for (const [index, row] of rows.entries()) {
      const c = classified[index];
      const m = merchants[index];
      const key = keys[index];
      if (c === undefined || key === undefined) continue;
      const abs = Math.abs(row.amount.minor);
      const skipped = row.amount.currency !== currency;
      // У перевода контрагента нет (снятие наличных, пополнение вклада): только описание.
      const merchantKey = m === undefined || m.key === "" || c.kind === "transfer" ? null : m.key;
      const category =
        c.kind === "transfer"
          ? null
          : c.categoryCode !== undefined
            ? { code: c.categoryCode, source: "keyword" }
            : categoryFor(categoryOf.get(index));
      // BYN по курсу НБРБ на день операции (STMT-09): курс один на валюту и день.
      let byn: { minor: number | null; rateId: string | null } = { minor: abs, rateId: null };
      if (currency !== "BYN" && !skipped) {
        const cacheKey = `${currency}|${abs}|${row.date}`;
        const cached = rates.get(cacheKey);
        if (cached === undefined) {
          const converted = await d.fxRates.convert(
            "transactions.amountInByn",
            node("transactions.amount", Money.of(abs, currency)),
            LocalDate.parse(row.date),
          );
          byn =
            converted === undefined
              ? { minor: null, rateId: null }
              : { minor: converted.calc.value.minor, rateId: converted.rate?.id ?? null };
          rates.set(cacheKey, byn);
        } else {
          byn = cached;
        }
      }
      let pairWithId: string | undefined;
      let cashCounterpart = false;
      if (c.kind === "transfer" && !duplicate[index] && !skipped) {
        if (c.transfer === "cash") {
          cashCounterpart = currency === "BYN";
        } else {
          const side = { date: row.date, direction: c.direction, minor: abs, currency };
          const free = candidates.filter((candidate) => !used.has(candidate.id));
          const pair = findCounterpart(side, free, transferWindow);
          if (pair !== undefined) {
            used.add(pair.id);
            pairWithId = pair.id;
          }
        }
      }
      let refundOfId: string | undefined;
      let refundOfIndex: number | undefined;
      if (c.kind === "refund" && !duplicate[index] && !skipped && merchantKey !== null) {
        const side = { date: row.date, merchantKey, minor: abs, currency };
        const own = result
          .filter(
            (earlier) =>
              earlier.kind === "expense" &&
              earlier.merchantKey === merchantKey &&
              !earlier.duplicate,
          )
          .map((earlier) => ({
            date: earlier.date,
            merchantKey: earlier.merchantKey,
            minor: Math.abs(earlier.minor),
            currency: earlier.currency,
            index: earlier.index,
          }));
        const inBatch = findPurchase(side, own, refundWindow);
        const stored = findPurchase(side, purchases, refundWindow);
        if (
          inBatch !== undefined &&
          (stored === undefined ||
            daysBetween(inBatch.date, row.date) <= daysBetween(stored.date, row.date))
        ) {
          refundOfIndex = inBatch.index;
        } else if (stored !== undefined) {
          refundOfId = stored.id;
        }
      }
      result.push({
        index,
        date: row.date,
        ...(row.time === undefined ? {} : { time: row.time }),
        minor: row.amount.minor,
        currency: row.amount.currency,
        description: row.description,
        merchantName: m === undefined || m.name === "" || c.kind === "transfer" ? null : m.name,
        merchantKey,
        kind: c.kind,
        direction: c.direction,
        category,
        duplicate: duplicate[index] === true,
        doubtful: c.doubtful,
        amountBynMinor: byn.minor,
        fxRateId: byn.rateId,
        dedupeKey: key.dedupeKey,
        ...(key.externalId === undefined ? {} : { externalId: key.externalId }),
        ...(pairWithId === undefined ? {} : { pairWithId }),
        ...(cashCounterpart ? { cashCounterpart } : {}),
        ...(refundOfId === undefined ? {} : { refundOfId }),
        ...(refundOfIndex === undefined ? {} : { refundOfIndex }),
        ...(skipped ? { skipped } : {}),
      });
    }
    return { rows: result, counts: summarize(result), accountExists: accountId !== undefined };
  }

  return buildPreview;
}

function categoryFor(
  item:
    | {
        category: { type: "system"; code: string } | { type: "custom"; id: string };
        source: string;
      }
    | undefined,
): PreviewRow["category"] {
  if (item === undefined) return null;
  return item.category.type === "system"
    ? { code: item.category.code, source: item.source }
    : { id: item.category.id, source: item.source };
}

export type BuildPreview = ReturnType<typeof makeBuildPreview>;
