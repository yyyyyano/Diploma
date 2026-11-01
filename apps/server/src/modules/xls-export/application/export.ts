// Выгрузка в Excel (XLS-01…04): период → операции соседей → числа `calc` → книга. Файл собирается по запросу и нигде не хранится;
// владелец данных — только `s` (сессия), период — из входа. Числа листов считает `domain/summary.ts`, формулы пишет `infrastructure`.
import {
  CategoryId,
  SystemCategoryCode,
  type CategoryRef,
  type XlsExportLink,
} from "@kosht/contract";
import { createT, createXlsT, type T } from "@kosht/i18n";
import { LocalDate } from "@kosht/kernel";
import type { ScopedDb } from "../../../platform/db/scoped-db.ts";
import { AppError } from "../../../platform/errors/app-error.ts";
import type { ExportInput, ExportRow } from "../domain/model.ts";
import { monthsBetween, summarize } from "../domain/summary.ts";
import { renderWorkbook } from "../infrastructure/workbook.ts";
import { MAX_MONTHS } from "../settings.ts";
import type { Deps } from "./deps.ts";

/** Страница операций при чтении: в контракте списка размер ≤ 100 (api-contract). */
const PAGE = 100;
const API = "/api";

export interface ExportPeriodInput {
  readonly from?: LocalDate | undefined;
  readonly to?: LocalDate | undefined;
}

export interface BuiltExport {
  readonly name: string;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly operations: number;
}

type AccountItem = Awaited<ReturnType<Deps["accounts"]["list"]>>["items"][number];

function accountLabel(t: T, account: AccountItem): string {
  if (account.name !== null) return account.name;
  if (account.bank !== null && account.mask !== null) {
    return t("accounts:maskName", { bank: account.bank, mask: account.mask });
  }
  return account.bank ?? t(`accounts:kind.${account.kind}`);
}

/** Название по ключу категории агрегата и лимитов: `system:<код>` или `custom:<id>`. */
function keyToRef(key: string): CategoryRef | null {
  const [kind, value] = key.split(/:(.*)/s);
  if (kind === "system") {
    const code = SystemCategoryCode.safeParse(value);
    return code.success ? { type: "system", code: code.data } : null;
  }
  const id = CategoryId.safeParse(value);
  return kind === "custom" && id.success ? { type: "custom", id: id.data } : null;
}

export function makeExport(d: Deps) {
  /** XLS-01: период не указан — текущий месяц; не по порядку или длиннее предела — VALIDATION. */
  async function period(input: ExportPeriodInput): Promise<{ from: LocalDate; to: LocalDate }> {
    const to = input.to ?? d.platform.clock.today();
    const from = input.from ?? LocalDate.parse(`${to.slice(0, 7)}-01`);
    if (from > to) throw new AppError("VALIDATION", { reason: "period-order" });
    const max = await d.platform.settings.get(MAX_MONTHS);
    if (monthsBetween(from, to).length > max) {
      throw new AppError("VALIDATION", { reason: "period-too-long", max });
    }
    return { from, to };
  }

  /** Все операции периода: страницами по 100, от старых к новым (журнал читается сверху вниз). */
  async function transactionsOf(s: ScopedDb, from: LocalDate, to: LocalDate) {
    const all: Awaited<ReturnType<Deps["transactions"]["list"]>>["items"] = [];
    for (let page = 1; ; page += 1) {
      const chunk = await d.transactions.list(s, { page, pageSize: PAGE, from, to });
      all.push(...chunk.items);
      if (chunk.items.length === 0 || page * PAGE >= chunk.total) break;
    }
    return all.toReversed();
  }

  async function collect(s: ScopedDb, from: LocalDate, to: LocalDate): Promise<ExportInput> {
    const t = createT();
    const xlsT = createXlsT();
    const limitMonth = to.slice(0, 7);
    const [items, accounts, categories, budgets] = await Promise.all([
      transactionsOf(s, from, to),
      d.accounts.list(s),
      d.categories.list(s),
      d.budgets.overview(s, limitMonth),
    ]);
    const accountNames = new Map(accounts.items.map((item) => [item.id, accountLabel(t, item)]));
    const customNames = new Map(
      categories.items.flatMap((item) =>
        item.ref.type === "custom" ? [[item.ref.id, item.name ?? ""] as const] : [],
      ),
    );
    const nameOf = (ref: CategoryRef | null): string => {
      if (ref === null) return xlsT("noCategory");
      return ref.type === "system"
        ? t(`categories:system.${ref.code}`)
        : (customNames.get(ref.id) ?? xlsT("noCategory"));
    };
    const rows = items.map((item): ExportRow => ({
      date: item.occurredOn,
      account: accountNames.get(item.accountId) ?? "",
      type: item.type,
      counterparty: item.merchantName ?? item.description,
      category: item.type === "transfer" ? "" : nameOf(item.category),
      amount: item.amount,
      amountByn: item.amountInByn,
    }));
    const limits = budgets.limits.map((limit) => {
      return { category: nameOf(keyToRef(limit.categoryKey)), limit: limit.limit };
    });
    return { from, to, rows, limitMonth, limits };
  }

  /** XLS-01…04: книга за период — байты `.xlsx`, имя файла только из латиницы и цифр. */
  async function build(s: ScopedDb, input: ExportPeriodInput): Promise<BuiltExport> {
    const { from, to } = await period(input);
    const data = await collect(s, from, to);
    const bytes = await renderWorkbook(data, summarize(data));
    d.platform.log.info({ count: data.rows.length, bytes: bytes.byteLength }, "xls.built");
    return { name: `kosht-${from}_${to}.xlsx`, bytes, operations: data.rows.length };
  }

  /** AGT-03: ссылка на скачивание за период — файл соберётся при открытии ссылки, здесь только число операций. */
  async function link(s: ScopedDb, input: ExportPeriodInput): Promise<XlsExportLink> {
    const { from, to } = await period(input);
    const { total } = await d.transactions.list(s, { page: 1, pageSize: 1, from, to });
    return {
      from,
      to,
      operations: total,
      url: `${API}/xls-export?from=${from}&to=${to}`,
    };
  }

  return { build, link };
}

export type Export = ReturnType<typeof makeExport>;
